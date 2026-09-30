-- AiroLink POS — Phase 4: suppliers + purchases (draft → received/cancelled).
-- Additive; run after 0006_auto_sku.sql. Never edits earlier migrations.
--
-- Design decisions:
--   - `suppliers` is an organization-scoped contact master (no balance column: supplier
--     balances/settlement are a later-phase accounting concern, not needed for receiving goods).
--   - Purchases mirror the sales write model: NO client INSERT/UPDATE/DELETE policies on
--     `purchases`/`purchase_items` — every write goes through a SECURITY DEFINER RPC, exactly
--     like sales/sale_items/payments go through complete_sale()/void_sale(). Draft creation is
--     therefore atomic (purchase + items in one transaction; no partial purchase possible).
--   - Receiving moves stock ONLY through `inventory_transactions` reason 'purchase' (already a
--     valid reason in the 0001 check constraint). The existing `inv_ins` RLS allowlist
--     (opening/adjustment/damaged/expired/count) deliberately excludes 'purchase'/'sale'/'return',
--     so only SECURITY DEFINER RPCs can write those reasons — no policy change needed here.
--   - Costing model: `products.cost_price` is stamped with the latest received unit cost per
--     product (last-purchase-price). No second pricing system is introduced: `sale_items.cost_price`
--     snapshots already persist per-sale cost, and `sales.tax_total` already persists tax, so NO
--     sales-schema change is needed for historical margin/tax accuracy (see Task 4H note in the
--     changelog entry). Profit/margin are derived: (unit_price - cost_price) x qty.
--   - Entitlement (`is_org_entitled()`) is checked in receive_purchase() (the stock-moving,
--     commercial step). Drafting/cancelling are planning steps with no stock effect and stay
--     available so a lapsed subscription never traps a business's paperwork.
--   - Only a 'draft' purchase can be received or cancelled. A received purchase is never
--     edited/deleted (same immutability principle as a completed sale); a mistaken draft is
--     cancelled and re-created.

-- ── Suppliers ────────────────────────────────────────────────────────────────
create table suppliers(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, org_id)
);
create index on suppliers(org_id, name);
create trigger t_touch before update on suppliers for each row execute function touch();

-- ── Purchases ────────────────────────────────────────────────────────────────
create table purchases(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  branch_id uuid not null,
  supplier_id uuid not null,
  ref_no text not null,
  status text not null default 'draft' check (status in ('draft','received','cancelled')),
  total numeric(14,2) not null default 0 check (total >= 0),
  note text,
  received_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, org_id),
  unique(org_id, ref_no),
  -- composite FKs make cross-tenant branch/supplier combinations structurally impossible
  foreign key (branch_id, org_id) references branches(id, org_id) on delete cascade,
  foreign key (supplier_id, org_id) references suppliers(id, org_id)
);
create index on purchases(org_id, branch_id, created_at desc);
create index on purchases(org_id, supplier_id);
create trigger t_touch before update on purchases for each row execute function touch();

create table purchase_items(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  purchase_id uuid not null,
  product_id uuid not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique(purchase_id, product_id),
  foreign key (purchase_id, org_id) references purchases(id, org_id) on delete cascade,
  foreign key (product_id, org_id) references products(id, org_id)
);
create index on purchase_items(purchase_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table suppliers enable row level security;
alter table purchases enable row level security;
alter table purchase_items enable row level security;

create policy suppliers_sel on suppliers for select using (role_in(org_id) is not null);
create policy suppliers_ins on suppliers for insert with check (can(org_id, array['owner','manager','inventory_officer','super_admin']::app_role[]));
create policy suppliers_upd on suppliers for update using (can(org_id, array['owner','manager','inventory_officer','super_admin']::app_role[])) with check (can(org_id, array['owner','manager','inventory_officer','super_admin']::app_role[]));
-- (no suppliers DELETE policy: suppliers are deactivated, never deleted — same model as products)

-- Purchase visibility is branch-aware, like sales. Items inherit branch context through
-- their parent purchase rather than duplicating a branch column (same model as sale_items).
create policy purchases_sel on purchases for select using (role_in(org_id) is not null and can_access_branch(branch_id));
create policy purchase_items_sel on purchase_items for select using (
  exists (select 1 from purchases p where p.id = purchase_items.purchase_id and role_in(p.org_id) is not null and can_access_branch(p.branch_id))
);
-- (no client INSERT/UPDATE/DELETE on purchases/purchase_items: every write goes through the
-- RPCs below — same model as sales/sale_items/payments, which have no client write policies.)

-- ── RPC: create a draft purchase (atomic: header + lines, server-computed totals) ──
-- p_items: [{product_id, qty, unit_cost}] — quantities/costs only; totals are computed HERE.
create function create_draft_purchase(p_org uuid, p_branch uuid, p_supplier uuid, p_note text default null, p_items jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare it jsonb; prod_id uuid; seen uuid[] := '{}'; q numeric; uc numeric; ln numeric; tot numeric := 0;
        pur_id uuid := gen_random_uuid(); refno text; n bigint;
begin
  if not can(p_org, array['owner','manager','inventory_officer','super_admin']::app_role[]) then raise exception 'Not authorized to manage purchases'; end if;
  if not exists (select 1 from branches where id = p_branch and org_id = p_org) then raise exception 'Invalid branch for this business'; end if;
  if not can_access_branch(p_branch) then raise exception 'No access to this branch'; end if;
  if not exists (select 1 from suppliers where id = p_supplier and org_id = p_org and is_active) then raise exception 'Supplier not found'; end if;
  if coalesce(jsonb_array_length(p_items),0) = 0 then raise exception 'Add at least one product'; end if;
  -- reference number from the same row-locked org_counters mechanism as receipts/SKUs
  insert into org_counters(org_id, name, value) values (p_org, 'purchase', 1)
    on conflict (org_id, name) do update set value = org_counters.value + 1
    returning value into n;
  refno := 'PO-' || to_char(now(),'YYMMDD') || '-' || lpad(n::text, 5, '0');
  insert into purchases(id, org_id, branch_id, supplier_id, ref_no, note) values (pur_id, p_org, p_branch, p_supplier, refno, nullif(trim(coalesce(p_note,'')), ''));
  for it in select value from jsonb_array_elements(p_items) loop
    prod_id := (it->>'product_id')::uuid;
    if prod_id = any(seen) then raise exception 'Duplicate product in purchase'; end if;
    seen := seen || prod_id;
    q := (it->>'qty')::numeric;
    if q is null or q <= 0 then raise exception 'Invalid quantity'; end if;
    uc := (it->>'unit_cost')::numeric;
    if uc is null or uc < 0 then raise exception 'Invalid unit cost'; end if;
    perform 1 from products where id = prod_id and org_id = p_org and is_active;
    if not found then raise exception 'Product unavailable'; end if;
    ln := round(q * uc, 2); tot := tot + ln;
    insert into purchase_items(org_id, purchase_id, product_id, qty, unit_cost, line_total)
      values (p_org, pur_id, prod_id, q, uc, ln);
  end loop;
  update purchases set total = tot where id = pur_id;
  insert into audit_logs(org_id,user_id,action,entity,entity_id,meta) values (p_org,auth.uid(),'purchase.create','purchases',pur_id,jsonb_build_object('ref',refno,'total',tot,'branch_id',p_branch));
  return pur_id;
end $$;
revoke all on function create_draft_purchase(uuid,uuid,uuid,text,jsonb) from public, anon;
grant execute on function create_draft_purchase(uuid,uuid,uuid,text,jsonb) to authenticated;

-- ── RPC: receive a draft purchase (atomic: ledger + cost stamping + status) ──
create function receive_purchase(p_org uuid, p_purchase uuid)
returns text language plpgsql security definer set search_path=public as $$
declare pur purchases; pi purchase_items; tot numeric := 0;
begin
  if not can(p_org, array['owner','manager','inventory_officer','super_admin']::app_role[]) then raise exception 'Not authorized to manage purchases'; end if;
  if not is_org_entitled(p_org) then raise exception 'Subscription is not active for this business'; end if;
  select * into pur from purchases where id = p_purchase and org_id = p_org for update;
  if not found then raise exception 'Purchase not found'; end if;
  if pur.status <> 'draft' then raise exception 'Only a draft purchase can be received'; end if;
  if not exists (select 1 from branches where id = pur.branch_id and org_id = p_org) then raise exception 'Invalid branch for this business'; end if;
  if not can_access_branch(pur.branch_id) then raise exception 'No access to this branch'; end if;
  perform set_config('app.ledger','on',true);
  for pi in select * from purchase_items where purchase_id = p_purchase order by product_id loop  -- consistent lock order avoids deadlocks
    perform 1 from products where id = pi.product_id and org_id = p_org and is_active for update;
    if not found then raise exception 'Product unavailable'; end if;
    -- the ledger trigger deducts/adds branch stock atomically and enforces allow_negative_stock
    insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason,ref_id) values (p_org,pur.branch_id,pi.product_id,pi.qty,'purchase',p_purchase);
    -- last-purchase-price costing: the received unit cost becomes the product cost,
    -- so future sale_items.cost_price snapshots (and POS margin) reflect reality
    update products set cost_price = pi.unit_cost where id = pi.product_id;
    tot := tot + pi.line_total;
  end loop;
  update purchases set status = 'received', received_at = now(), total = tot where id = p_purchase;
  insert into audit_logs(org_id,user_id,action,entity,entity_id,meta) values (p_org,auth.uid(),'purchase.receive','purchases',p_purchase,jsonb_build_object('ref',pur.ref_no,'total',tot,'branch_id',pur.branch_id));
  return pur.ref_no;
end $$;
revoke all on function receive_purchase(uuid,uuid) from public, anon;
grant execute on function receive_purchase(uuid,uuid) to authenticated;

-- ── RPC: cancel a draft purchase (received purchases are immutable, like completed sales) ──
create function cancel_purchase(p_org uuid, p_purchase uuid, p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare pur purchases;
begin
  if not can(p_org, array['owner','manager','inventory_officer','super_admin']::app_role[]) then raise exception 'Not authorized to manage purchases'; end if;
  select * into pur from purchases where id = p_purchase and org_id = p_org for update;
  if not found then raise exception 'Purchase not found'; end if;
  if pur.status <> 'draft' then raise exception 'Only a draft purchase can be cancelled'; end if;
  update purchases set status = 'cancelled' where id = p_purchase;
  insert into audit_logs(org_id,user_id,action,entity,entity_id,meta) values (p_org,auth.uid(),'purchase.cancel','purchases',p_purchase,jsonb_build_object('ref',pur.ref_no,'reason',p_reason));
end $$;
revoke all on function cancel_purchase(uuid,uuid,text) from public, anon;
grant execute on function cancel_purchase(uuid,uuid,text) to authenticated;
