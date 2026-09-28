-- AiroLink POS — Phase 1 re-baseline: branches, branch-membership foundation,
-- subscription/plan/entitlement model. Additive only; run after 0001_core.sql.

-- ── Branches ──────────────────────────────────────────────────────────────
create table branches(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  name text not null,
  address text,
  phone text,
  is_main boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, name)
);
create index on branches(org_id, is_active);
create trigger t_touch before update on branches for each row execute function touch();
-- exactly one main branch per organization
create unique index branches_one_main_per_org on branches(org_id) where is_main;

-- ── Branch membership foundation ────────────────────────────────────────────
-- Data model only: lets a user be scoped to specific branches later (Phase 6
-- builds the admin UI). A user may belong to more than one branch, so this is
-- a plain many-to-many join, never a single branch_id on profiles/members.
create table branch_members(
  branch_id uuid not null references branches on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key(branch_id, user_id)
);
create index on branch_members(user_id);

-- ── Plans ────────────────────────────────────────────────────────────────
create table plans(
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  price numeric(10,2) not null default 0 check (price >= 0),
  currency text not null default 'GHS',
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly','yearly','none')),
  max_branches int,
  max_users int,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger t_touch before update on plans for each row execute function touch();

insert into plans(code,name,description,price,currency,billing_interval,max_branches,max_users,features) values
  ('trial','Free Trial','14-day trial with full access',0,'GHS','none',1,3,'{"pos":true,"inventory":true,"reports":false}'::jsonb),
  ('starter','Starter','For a single shop with one branch',150,'GHS','monthly',1,5,'{"pos":true,"inventory":true,"reports":true}'::jsonb),
  ('growth','Growth','For growing businesses with multiple branches',450,'GHS','monthly',5,20,'{"pos":true,"inventory":true,"reports":true}'::jsonb);

-- ── Subscriptions ────────────────────────────────────────────────────────
-- One current subscription row per organization. Status changes only ever
-- happen server-side (billing RPCs added when a payment provider is wired
-- up, or the service role) — there is deliberately no client insert/update
-- policy below.
create table subscriptions(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organizations on delete cascade,
  plan_id uuid references plans,
  status text not null default 'trialing' check (status in ('pending','trialing','active','past_due','cancelled','expired','suspended')),
  trial_starts_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger t_touch before update on subscriptions for each row execute function touch();

-- ── Entitlement ──────────────────────────────────────────────────────────
-- True while the organization's subscription is trialing/active and still
-- inside its current window. This is the single source of truth checked by
-- every protected commercial RPC — never trust a client-supplied flag.
create function is_org_entitled(org uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from subscriptions
    where org_id = org
      and status in ('trialing','active')
      and (status <> 'trialing' or trial_ends_at is null or trial_ends_at > now())
      and (status <> 'active' or current_period_end is null or current_period_end > now())
  )
$$;
grant execute on function is_org_entitled(uuid) to authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table branches enable row level security;
alter table branch_members enable row level security;
alter table plans enable row level security;
alter table subscriptions enable row level security;

create policy branch_sel on branches for select using (role_in(org_id) is not null);
create policy branch_ins on branches for insert with check (can(org_id, array['owner','super_admin']::app_role[]));
create policy branch_upd on branches for update using (can(org_id, array['owner','super_admin']::app_role[])) with check (can(org_id, array['owner','super_admin']::app_role[]));

create policy branch_mem_sel on branch_members for select using (
  exists (select 1 from branches b where b.id = branch_members.branch_id and role_in(b.org_id) is not null)
);
create policy branch_mem_all on branch_members for all using (
  exists (select 1 from branches b where b.id = branch_members.branch_id and can(b.org_id, array['owner','manager','super_admin']::app_role[]))
) with check (
  exists (select 1 from branches b where b.id = branch_members.branch_id and can(b.org_id, array['owner','manager','super_admin']::app_role[]))
);

create policy plans_sel on plans for select using (is_active);
-- (no client insert/update/delete on plans: catalog is platform-managed)

create policy sub_sel on subscriptions for select using (role_in(org_id) is not null);
-- (no client insert/update/delete on subscriptions: see comment on the table above)

-- ── create_organization(): now also provisions a default branch + trial ──
create or replace function create_organization(p_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare o uuid; trial_plan uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if length(trim(p_name)) < 2 then raise exception 'Business name is required'; end if;
  insert into organizations(name) values (trim(p_name)) returning id into o;
  insert into organization_members(org_id,user_id,role) values (o, auth.uid(), 'owner');
  insert into org_counters(org_id,name) values (o,'receipt');
  insert into branches(org_id,name,is_main) values (o,'Main Branch',true);
  select id into trial_plan from plans where code = 'trial';
  insert into subscriptions(org_id,plan_id,status,trial_starts_at,trial_ends_at,current_period_start,current_period_end)
    values (o, trial_plan, 'trialing', now(), now() + interval '14 days', now(), now() + interval '14 days');
  insert into audit_logs(org_id,user_id,action,entity,entity_id) values (o, auth.uid(), 'org.create', 'organizations', o);
  return o;
end $$;

-- ── complete_sale(): now requires an entitled subscription ────────────────
-- (unchanged logic otherwise; only the entitlement check is added)
create or replace function complete_sale(p_org uuid, p_items jsonb, p_payments jsonb, p_customer uuid default null, p_discount numeric default 0)
returns text language plpgsql security definer set search_path=public as $$
declare it jsonb; pay jsonb; pr products; cu customers; q numeric; ln numeric; sub numeric := 0; taxable numeric := 0; tax numeric := 0; tot numeric;
        paid numeric := 0; due numeric; rate numeric; sid uuid := gen_random_uuid(); rno text; n bigint;
begin
  if not can(p_org, array['owner','manager','cashier','super_admin']::app_role[]) then raise exception 'Not authorized to make sales'; end if;
  if not is_org_entitled(p_org) then raise exception 'Subscription is not active for this business'; end if;
  if coalesce(jsonb_array_length(p_items),0) = 0 then raise exception 'Cart is empty'; end if;
  if p_discount < 0 then raise exception 'Invalid discount'; end if;
  select tax_rate into rate from organizations where id = p_org;
  perform set_config('app.ledger','on',true);
  update org_counters set value = value + 1 where org_id = p_org and name = 'receipt' returning value into n;
  rno := 'R-' || to_char(now(),'YYMMDD') || '-' || lpad(n::text, 5, '0');
  insert into sales(id,org_id,receipt_no,customer_id) values (sid,p_org,rno,p_customer);
  for it in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop  -- consistent lock order avoids deadlocks
    q := (it->>'qty')::numeric;
    if q is null or q <= 0 then raise exception 'Invalid quantity'; end if;
    select * into pr from products where id = (it->>'product_id')::uuid and org_id = p_org and is_active for update;
    if not found then raise exception 'Product unavailable'; end if;
    ln := round(pr.selling_price * q, 2); sub := sub + ln; if pr.taxable then taxable := taxable + ln; end if;
    insert into sale_items(org_id,sale_id,product_id,name,qty,unit_price,cost_price,line_total) values (p_org,sid,pr.id,pr.name,q,pr.selling_price,pr.cost_price,ln);
    insert into inventory_transactions(org_id,product_id,qty_change,reason,ref_id) values (p_org,pr.id,-q,'sale',sid);  -- trigger deducts stock, blocks negatives
  end loop;
  if p_discount > sub then raise exception 'Discount exceeds subtotal'; end if;
  if sub > 0 then tax := round(taxable * (sub - p_discount) / sub * rate / 100, 2); end if;
  tot := sub - p_discount + tax;
  for pay in select value from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) loop
    if (pay->>'amount')::numeric <= 0 then raise exception 'Invalid payment amount'; end if;
    insert into payments(org_id,sale_id,method,amount,reference) values (p_org,sid,pay->>'method',(pay->>'amount')::numeric,pay->>'reference');
    paid := paid + (pay->>'amount')::numeric;
  end loop;
  if paid > tot then raise exception 'Payments exceed the total'; end if;
  due := tot - paid;
  if due > 0 then  -- credit sale
    if p_customer is null then raise exception 'Choose a customer for a credit sale'; end if;
    select * into cu from customers where id = p_customer and org_id = p_org and is_active for update;
    if not found then raise exception 'Customer not found'; end if;
    if cu.balance + due > cu.credit_limit then raise exception 'Credit limit exceeded'; end if;
    update customers set balance = balance + due where id = cu.id;
    insert into customer_transactions(org_id,customer_id,kind,debit,ref_id) values (p_org,cu.id,'sale',due,sid);
  end if;
  update sales set subtotal=sub, discount_total=p_discount, tax_total=tax, total=tot, amount_paid=paid, balance_due=due where id = sid;
  insert into audit_logs(org_id,user_id,action,entity,entity_id,meta) values (p_org,auth.uid(),'sale.create','sales',sid,jsonb_build_object('receipt',rno,'total',tot));
  return rno;
end $$;
