-- AiroLink POS — Phase 2: products stay organization-scoped; inventory becomes
-- branch-scoped. Additive/evolutionary; run after 0002_phase1_foundation.sql.
--
-- Design decision (see ARCHITECTURE.md §5.3 for the write-up):
--   products.stock_qty / products.min_stock (one number per organization) are
--   replaced by a branch_inventory row per (org, branch, product). A product's
--   identity (SKU/barcode/name/price/category) stays organization-scoped, as
--   specified — only the stock number moves. Composite foreign keys (rather
--   than a trigger) are used to make cross-tenant branch/product combinations
--   structurally impossible.

-- ── Upgrade safety: organizations that already existed before branches/subscriptions ──
-- 0002 created `branches` and `subscriptions`, but a database that already had organizations (created
-- under Phase 1) has neither a main branch nor a subscription row for them. Everything below assumes
-- every organization has exactly one main branch (stock, ledger and sales are moved onto it), and the
-- app treats a missing subscription as "not entitled" (POS locked), so both are created here.
-- Idempotent: organizations that already have them (everything created by create_organization()) are untouched.
-- (This lives in 0003, not 0002, so it also protects databases where 0002 was already applied.)
update branches b set is_main = true
 where b.id = (select b2.id from branches b2 where b2.org_id = b.org_id order by b2.created_at, b2.id limit 1)
   and not exists (select 1 from branches m where m.org_id = b.org_id and m.is_main);
insert into branches(org_id, name, is_main)
select o.id, 'Main Branch', true from organizations o
 where not exists (select 1 from branches b where b.org_id = o.id);
-- Existing organizations get the standard 14-day trial starting now, so an upgrade never locks a business out of POS.
insert into subscriptions(org_id, plan_id, status, trial_starts_at, trial_ends_at, current_period_start, current_period_end)
select o.id, (select id from plans where code = 'trial'), 'trialing', now(), now() + interval '14 days', now(), now() + interval '14 days'
  from organizations o
 where not exists (select 1 from subscriptions s where s.org_id = o.id);

-- ── Composite keys needed for tenant-safe composite foreign keys ──────────
alter table branches add constraint branches_id_org_uniq unique (id, org_id);
alter table products add constraint products_id_org_uniq unique (id, org_id);

-- ── Branch-scoped stock ────────────────────────────────────────────────────
create table branch_inventory(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  branch_id uuid not null,
  product_id uuid not null,
  stock_qty numeric(14,3) not null default 0,
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, branch_id, product_id),
  -- both of these make it structurally impossible to pair a branch/product
  -- from one organization with a row belonging to another organization
  foreign key (branch_id, org_id) references branches(id, org_id) on delete cascade,
  foreign key (product_id, org_id) references products(id, org_id) on delete cascade
);
create index on branch_inventory(org_id, product_id);
create trigger t_touch before update on branch_inventory for each row execute function touch();

-- Backfill: every existing product's org-wide stock/min_stock becomes its
-- stock at the organization's (only, at this point) main branch. No data is
-- lost or fabricated — this is a straight carry-over of the existing numbers.
insert into branch_inventory(org_id, branch_id, product_id, stock_qty, min_stock)
select p.org_id, b.id, p.id, p.stock_qty, p.min_stock
from products p
join branches b on b.org_id = p.org_id and b.is_main;

-- The old org-wide stock guard no longer applies (the column is being
-- removed); a new, equivalent guard is added for branch_inventory below.
drop trigger if exists t_guard on products;
alter table products drop column stock_qty;
alter table products drop column min_stock;

create function guard_branch_inventory() returns trigger language plpgsql as $$
begin
  if current_setting('app.ledger', true) is distinct from 'on' then
    if tg_op = 'INSERT' and new.stock_qty is distinct from 0 then
      raise exception 'Stock can only change via inventory_transactions';
    elsif tg_op = 'UPDATE' and new.stock_qty is distinct from old.stock_qty then
      raise exception 'Stock can only change via inventory_transactions';
    end if;
  end if;
  return new;
end $$;
create trigger t_guard before insert or update on branch_inventory for each row execute function guard_branch_inventory();

-- apply_inventory() now maintains branch_inventory instead of products.stock_qty.
create or replace function apply_inventory() returns trigger language plpgsql security definer set search_path=public as $$
declare s numeric; neg boolean;
begin
  perform set_config('app.ledger','on',true);
  insert into branch_inventory(org_id,branch_id,product_id,stock_qty)
    values (new.org_id,new.branch_id,new.product_id,new.qty_change)
  on conflict (org_id,branch_id,product_id) do update set stock_qty = branch_inventory.stock_qty + excluded.stock_qty
  returning stock_qty into s;
  select allow_negative_stock into neg from organizations where id = new.org_id;
  if s < 0 and not coalesce(neg, false) then raise exception 'Insufficient stock'; end if;
  return new;
end $$;

-- ── inventory_transactions becomes branch-aware ───────────────────────────
alter table inventory_transactions add column branch_id uuid;
update inventory_transactions it set branch_id = (select b.id from branches b where b.org_id = it.org_id and b.is_main);
alter table inventory_transactions alter column branch_id set not null;

-- Replace the old single-column product_id FK with a tenant-safe composite one.
do $$
declare c text;
begin
  select conname into c from pg_constraint
    where conrelid = 'inventory_transactions'::regclass and contype = 'f'
      and array_length(conkey,1) = 1
      and (select attname from pg_attribute where attrelid = 'inventory_transactions'::regclass and attnum = conkey[1]) = 'product_id';
  if c is not null then execute format('alter table inventory_transactions drop constraint %I', c); end if;
end $$;
alter table inventory_transactions add constraint invtx_product_org_fk foreign key (product_id, org_id) references products(id, org_id);
alter table inventory_transactions add constraint invtx_branch_org_fk foreign key (branch_id, org_id) references branches(id, org_id);
create index on inventory_transactions(branch_id, product_id, created_at desc);

-- ── sales get a branch, so Phase 3 does not need a destructive redesign ───
alter table sales add column branch_id uuid;
update sales s set branch_id = (select b.id from branches b where b.org_id = s.org_id and b.is_main);
alter table sales alter column branch_id set not null;
alter table sales add constraint sales_branch_org_fk foreign key (branch_id, org_id) references branches(id, org_id);
create index on sales(branch_id, created_at desc);

-- ── Branch access model ────────────────────────────────────────────────────
-- Backward compatible: a user with no branch_members rows in an organization
-- has unrestricted access to every branch of that organization (today's
-- behavior, since branch_members is empty for everyone). A user who DOES
-- have one or more branch_members rows in that organization is scoped to
-- exactly those branches. This lets Phase 6 introduce per-user branch
-- restriction later without any further schema change.
create function can_access_branch(b uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from branches br
    where br.id = b
      and role_in(br.org_id) is not null
      and (
        not exists (
          select 1 from branch_members bm join branches br2 on br2.id = bm.branch_id
          where br2.org_id = br.org_id and bm.user_id = auth.uid()
        )
        or exists (select 1 from branch_members bm where bm.branch_id = b and bm.user_id = auth.uid())
      )
  )
$$;
grant execute on function can_access_branch(uuid) to authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table branch_inventory enable row level security;
create policy braninv_sel on branch_inventory for select using (role_in(org_id) is not null and can_access_branch(branch_id));
create policy braninv_ins on branch_inventory for insert with check (can(org_id, array['owner','manager','inventory_officer']::app_role[]) and can_access_branch(branch_id));
create policy braninv_upd on branch_inventory for update using (can(org_id, array['owner','manager','inventory_officer']::app_role[]) and can_access_branch(branch_id)) with check (can(org_id, array['owner','manager','inventory_officer']::app_role[]) and can_access_branch(branch_id));

-- inventory_transactions' existing select/insert policies (from 0001) were
-- organization-wide; replace them with branch-aware equivalents.
drop policy if exists inventory_transactions_sel on inventory_transactions;
create policy invtx_sel on inventory_transactions for select using (role_in(org_id) is not null and can_access_branch(branch_id));
drop policy if exists inv_ins on inventory_transactions;
create policy inv_ins on inventory_transactions for insert with check (
  can(org_id, array['owner','manager','inventory_officer']::app_role[])
  and can_access_branch(branch_id)
  and reason in ('opening','adjustment','damaged','expired','count')
);

-- ── complete_sale(): branch-aware ─────────────────────────────────────────
-- The parameter list changes (a branch is now required), so the old 5-arg
-- overload is dropped rather than left behind as a second, competing entry
-- point.
drop function if exists complete_sale(uuid, jsonb, jsonb, uuid, numeric);

create function complete_sale(p_org uuid, p_branch uuid, p_items jsonb, p_payments jsonb, p_customer uuid default null, p_discount numeric default 0)
returns text language plpgsql security definer set search_path=public as $$
declare it jsonb; pay jsonb; pr products; cu customers; q numeric; ln numeric; sub numeric := 0; taxable numeric := 0; tax numeric := 0; tot numeric;
        paid numeric := 0; due numeric; rate numeric; sid uuid := gen_random_uuid(); rno text; n bigint;
begin
  if not can(p_org, array['owner','manager','cashier','super_admin']::app_role[]) then raise exception 'Not authorized to make sales'; end if;
  if not is_org_entitled(p_org) then raise exception 'Subscription is not active for this business'; end if;
  if not exists (select 1 from branches where id = p_branch and org_id = p_org) then raise exception 'Invalid branch for this business'; end if;
  if not can_access_branch(p_branch) then raise exception 'No access to this branch'; end if;
  if coalesce(jsonb_array_length(p_items),0) = 0 then raise exception 'Cart is empty'; end if;
  if p_discount < 0 then raise exception 'Invalid discount'; end if;
  select tax_rate into rate from organizations where id = p_org;
  perform set_config('app.ledger','on',true);
  update org_counters set value = value + 1 where org_id = p_org and name = 'receipt' returning value into n;
  rno := 'R-' || to_char(now(),'YYMMDD') || '-' || lpad(n::text, 5, '0');
  insert into sales(id,org_id,branch_id,receipt_no,customer_id) values (sid,p_org,p_branch,rno,p_customer);
  for it in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop  -- consistent lock order avoids deadlocks
    q := (it->>'qty')::numeric;
    if q is null or q <= 0 then raise exception 'Invalid quantity'; end if;
    select * into pr from products where id = (it->>'product_id')::uuid and org_id = p_org and is_active for update;
    if not found then raise exception 'Product unavailable'; end if;
    ln := round(pr.selling_price * q, 2); sub := sub + ln; if pr.taxable then taxable := taxable + ln; end if;
    insert into sale_items(org_id,sale_id,product_id,name,qty,unit_price,cost_price,line_total) values (p_org,sid,pr.id,pr.name,q,pr.selling_price,pr.cost_price,ln);
    insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason,ref_id) values (p_org,p_branch,pr.id,-q,'sale',sid);  -- trigger deducts branch stock, blocks negatives
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
  insert into audit_logs(org_id,user_id,action,entity,entity_id,meta) values (p_org,auth.uid(),'sale.create','sales',sid,jsonb_build_object('receipt',rno,'total',tot,'branch_id',p_branch));
  return rno;
end $$;

revoke all on function complete_sale(uuid,uuid,jsonb,jsonb,uuid,numeric) from public, anon;
grant execute on function complete_sale(uuid,uuid,jsonb,jsonb,uuid,numeric) to authenticated;
