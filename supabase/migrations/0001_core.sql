-- AiroLink POS core schema. Run in order via `supabase db push` or the SQL editor.
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create type app_role as enum ('super_admin','owner','manager','cashier','inventory_officer','accountant');

create table organizations(
  id uuid primary key default gen_random_uuid(), name text not null, address text, phone text, email text,
  currency text not null default 'GHS', tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  allow_negative_stock boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table profiles(id uuid primary key references auth.users on delete cascade, full_name text, created_at timestamptz not null default now());
create table organization_members(
  org_id uuid not null references organizations on delete cascade, user_id uuid not null references auth.users on delete cascade,
  role app_role not null, created_at timestamptz not null default now(), primary key(org_id,user_id));
create index on organization_members(user_id);

create table categories(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  name text not null, created_at timestamptz not null default now(), unique(org_id,name));
create table products(
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  category_id uuid references categories on delete set null, sku text not null, barcode text, name text not null, description text, brand text,
  unit text not null default 'pcs', cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  selling_price numeric(14,2) not null check (selling_price >= 0), taxable boolean not null default true,
  stock_qty numeric(14,3) not null default 0, min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  image_url text, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(org_id,sku), unique(org_id,barcode));
create index on products(org_id,is_active,name);
create index products_name_trgm on products using gin (name gin_trgm_ops);

create table customers(
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  name text not null, phone text, email text, address text, credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  balance numeric(14,2) not null default 0, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index on customers(org_id,name);
create table customer_transactions(
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  customer_id uuid not null references customers, kind text not null check (kind in ('sale','payment','refund')),
  debit numeric(14,2) not null default 0 check (debit >= 0), credit numeric(14,2) not null default 0 check (credit >= 0),
  ref_id uuid, created_at timestamptz not null default now());
create index on customer_transactions(customer_id,created_at);

create table org_counters(org_id uuid not null references organizations on delete cascade, name text not null, value bigint not null default 0, primary key(org_id,name));
create table sales(
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, receipt_no text not null,
  customer_id uuid references customers, cashier_id uuid default auth.uid() references auth.users,
  status text not null default 'completed' check (status in ('completed','partial_refund','refunded','void')),
  subtotal numeric(14,2) not null default 0, discount_total numeric(14,2) not null default 0, tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0 check (total >= 0), amount_paid numeric(14,2) not null default 0, balance_due numeric(14,2) not null default 0,
  created_at timestamptz not null default now(), unique(org_id,receipt_no));
create index on sales(org_id,created_at desc);
create table sale_items(
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, sale_id uuid not null references sales on delete cascade,
  product_id uuid not null references products, name text not null, qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0), cost_price numeric(14,2) not null, line_total numeric(14,2) not null);
create index on sale_items(sale_id);
create table payments(
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, sale_id uuid not null references sales on delete cascade,
  method text not null check (method in ('cash','momo','card','bank','other')), amount numeric(14,2) not null check (amount > 0), reference text, created_at timestamptz not null default now());
create table inventory_transactions(
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, product_id uuid not null references products,
  qty_change numeric(14,3) not null check (qty_change <> 0),
  reason text not null check (reason in ('opening','purchase','sale','return','adjustment','damaged','expired','count')),
  ref_id uuid, note text, created_by uuid default auth.uid(), created_at timestamptz not null default now());
create index on inventory_transactions(product_id,created_at desc);
create table audit_logs(
  id uuid primary key default gen_random_uuid(), org_id uuid references organizations on delete cascade, user_id uuid, action text not null,
  entity text not null, entity_id uuid, meta jsonb, created_at timestamptz not null default now());
create index on audit_logs(org_id,created_at desc);

-- helpers
create function role_in(org uuid) returns app_role language sql stable security definer set search_path=public as
$$ select role from organization_members where org_id = org and user_id = auth.uid() $$;
create function can(org uuid, roles app_role[]) returns boolean language sql stable security definer set search_path=public as
$$ select coalesce(role_in(org) = any(roles), false) $$;
create function touch() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger t_touch before update on products for each row execute function touch();
create trigger t_touch before update on customers for each row execute function touch();
create trigger t_touch before update on organizations for each row execute function touch();

-- stock and balances change ONLY through the ledger functions below
create function guard_ledger() returns trigger language plpgsql as $$
begin
  if current_setting('app.ledger', true) is distinct from 'on' then
    if tg_table_name = 'products' then
      if new.stock_qty is distinct from old.stock_qty then raise exception 'Stock can only change via inventory_transactions'; end if;
    elsif new.balance is distinct from old.balance then raise exception 'Balance can only change via ledger'; end if;
  end if; return new;
end $$;
create trigger t_guard before update on products for each row execute function guard_ledger();
create trigger t_guard before update on customers for each row execute function guard_ledger();

create function apply_inventory() returns trigger language plpgsql security definer set search_path=public as $$
declare s numeric;
begin
  perform set_config('app.ledger','on',true);
  update products set stock_qty = stock_qty + new.qty_change where id = new.product_id and org_id = new.org_id returning stock_qty into s;
  if not found then raise exception 'Product not found in this business'; end if;
  if s < 0 and not (select allow_negative_stock from organizations where id = new.org_id) then raise exception 'Insufficient stock'; end if;
  return new;
end $$;
create trigger t_apply after insert on inventory_transactions for each row execute function apply_inventory();

create function audit_products() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_logs(org_id,user_id,action,entity,entity_id,meta) values (new.org_id,auth.uid(),'product.create','products',new.id,jsonb_build_object('sku',new.sku,'name',new.name));
  elsif (old.selling_price,old.cost_price,old.is_active) is distinct from (new.selling_price,new.cost_price,new.is_active) then
    insert into audit_logs(org_id,user_id,action,entity,entity_id,meta) values (new.org_id,auth.uid(),'product.update','products',new.id,
      jsonb_build_object('old',jsonb_build_object('selling_price',old.selling_price,'cost_price',old.cost_price,'is_active',old.is_active),
                         'new',jsonb_build_object('selling_price',new.selling_price,'cost_price',new.cost_price,'is_active',new.is_active)));
  end if; return new;
end $$;
create trigger t_audit after insert or update on products for each row execute function audit_products();

create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into profiles(id,full_name) values (new.id, new.raw_user_meta_data->>'full_name'); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- RLS: every table; reads need membership, writes need the right role. No client INSERT/UPDATE on sales, payments, ledgers.
do $$ declare t text; begin
  foreach t in array array['organizations','profiles','organization_members','categories','products','customers','customer_transactions','org_counters','sales','sale_items','payments','inventory_transactions','audit_logs'] loop
    execute format('alter table %I enable row level security', t); end loop;
  foreach t in array array['categories','products','customers','customer_transactions','sales','sale_items','payments','inventory_transactions'] loop
    execute format('create policy %I on %I for select using (role_in(org_id) is not null)', t||'_sel', t); end loop;
end $$;
create policy org_sel on organizations for select using (role_in(id) is not null);
create policy org_upd on organizations for update using (can(id, array['owner','super_admin']::app_role[])) with check (can(id, array['owner','super_admin']::app_role[]));
create policy prof_sel on profiles for select using (id = auth.uid() or exists (select 1 from organization_members a join organization_members b on a.org_id = b.org_id where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy prof_upd on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy mem_sel on organization_members for select using (role_in(org_id) is not null);
create policy mem_all on organization_members for all using (can(org_id, array['owner','super_admin']::app_role[])) with check (can(org_id, array['owner','super_admin']::app_role[]));
create policy cat_w on categories for all using (can(org_id, array['owner','manager','inventory_officer']::app_role[])) with check (can(org_id, array['owner','manager','inventory_officer']::app_role[]));
create policy prod_ins on products for insert with check (can(org_id, array['owner','manager','inventory_officer']::app_role[]));
create policy prod_upd on products for update using (can(org_id, array['owner','manager','inventory_officer']::app_role[])) with check (can(org_id, array['owner','manager','inventory_officer']::app_role[]));
create policy cust_ins on customers for insert with check (can(org_id, array['owner','manager','cashier']::app_role[]) and balance = 0);
create policy cust_upd on customers for update using (can(org_id, array['owner','manager','cashier']::app_role[])) with check (can(org_id, array['owner','manager','cashier']::app_role[]));
create policy inv_ins on inventory_transactions for insert with check (can(org_id, array['owner','manager','inventory_officer']::app_role[]) and reason in ('opening','adjustment','damaged','expired','count'));
create policy audit_sel on audit_logs for select using (can(org_id, array['owner','manager','accountant','super_admin']::app_role[]));
-- (no products DELETE policy: products are deactivated, never deleted)

-- RPC: create a business; caller becomes owner
create function create_organization(p_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare o uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if length(trim(p_name)) < 2 then raise exception 'Business name is required'; end if;
  insert into organizations(name) values (trim(p_name)) returning id into o;
  insert into organization_members(org_id,user_id,role) values (o, auth.uid(), 'owner');
  insert into org_counters(org_id,name) values (o,'receipt');
  insert into audit_logs(org_id,user_id,action,entity,entity_id) values (o, auth.uid(), 'org.create', 'organizations', o);
  return o;
end $$;

-- RPC: atomic sale. Prices/tax/totals are computed HERE from the database, never trusted from the browser.
-- p_items: [{product_id, qty}]   p_payments: [{method, amount, reference?}] (amount = value applied to the bill, no change)
create function complete_sale(p_org uuid, p_items jsonb, p_payments jsonb, p_customer uuid default null, p_discount numeric default 0)
returns text language plpgsql security definer set search_path=public as $$
declare it jsonb; pay jsonb; pr products; cu customers; q numeric; ln numeric; sub numeric := 0; taxable numeric := 0; tax numeric := 0; tot numeric;
        paid numeric := 0; due numeric; rate numeric; sid uuid := gen_random_uuid(); rno text; n bigint;
begin
  if not can(p_org, array['owner','manager','cashier','super_admin']::app_role[]) then raise exception 'Not authorized to make sales'; end if;
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

revoke all on function create_organization(text), complete_sale(uuid,jsonb,jsonb,uuid,numeric) from public, anon;
grant execute on function create_organization(text), complete_sale(uuid,jsonb,jsonb,uuid,numeric) to authenticated;
grant execute on function role_in(uuid), can(uuid, app_role[]) to authenticated;
