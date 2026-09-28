-- AiroLink POS — Phase 3: POS + Sales + Payments + Receipts.
-- Additive; run after 0003_phase2_products_inventory.sql.
--
-- What actually needed to change here (see ARCHITECTURE.md §5.4 for the
-- write-up): complete_sale() was already branch-aware, atomic, server-
-- authoritative on price/tax/entitlement, and already supported split
-- payments (it loops over p_payments) — none of that needed touching. The
-- real Phase 2 gap this phase closes is that `sales`/`sale_items`/`payments`
-- were still readable organization-wide regardless of branch, and there was
-- no safe way to cancel a completed sale. Both are fixed additively below;
-- sale_items and payments did not need a new branch_id column, since their
-- branch context is already available securely via their parent sale_id.

-- ── Sales visibility becomes branch-aware ─────────────────────────────────
drop policy if exists sales_sel on sales;
create policy sales_sel on sales for select using (role_in(org_id) is not null and can_access_branch(branch_id));

drop policy if exists sale_items_sel on sale_items;
create policy sale_items_sel on sale_items for select using (
  exists (select 1 from sales s where s.id = sale_items.sale_id and role_in(s.org_id) is not null and can_access_branch(s.branch_id))
);

drop policy if exists payments_sel on payments;
create policy payments_sel on payments for select using (
  exists (select 1 from sales s where s.id = payments.sale_id and role_in(s.org_id) is not null and can_access_branch(s.branch_id))
);

-- Supports the EXISTS lookups above and payment history queries; sale_items
-- already had an index on sale_id.
create index if not exists payments_sale_id_idx on payments(sale_id);
-- Supports branch-filtered sales history (org_id, branch_id already backed
-- individually; this composite serves the common "this branch, newest first"
-- query directly).
create index if not exists sales_org_branch_created_idx on sales(org_id, branch_id, created_at desc);

-- ── void_sale(): safe, atomic cancellation of a completed sale ───────────
-- A void never deletes the sale (it stays as the permanent historical
-- record with status='void'), restores the branch stock it consumed via an
-- ordinary 'return' ledger entry, and reverses any credit-sale impact on
-- the customer's balance. It deliberately does NOT touch the payments
-- table or attempt to reverse an actual cash/mobile-money refund — physically
-- returning money is a real-world till operation outside the database's
-- authority, and building that reconciliation is explicitly out of scope
-- for Phase 3 (see CHANGELOG.md "deferred").
create function void_sale(p_org uuid, p_sale uuid, p_reason text default null) returns void language plpgsql security definer set search_path=public as $$
declare s sales; it sale_items;
begin
  if not can(p_org, array['owner','manager','super_admin']::app_role[]) then raise exception 'Not authorized to void sales'; end if;
  select * into s from sales where id = p_sale and org_id = p_org for update;
  if not found then raise exception 'Sale not found'; end if;
  if not can_access_branch(s.branch_id) then raise exception 'No access to this branch'; end if;
  if s.status <> 'completed' then raise exception 'Only a completed sale can be voided'; end if;
  perform set_config('app.ledger','on',true);
  for it in select * from sale_items where sale_id = p_sale loop
    insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason,ref_id,note)
      values (p_org, s.branch_id, it.product_id, it.qty, 'return', s.id, coalesce(p_reason, 'Sale voided'));
  end loop;
  if s.balance_due > 0 and s.customer_id is not null then
    update customers set balance = balance - s.balance_due where id = s.customer_id;
    insert into customer_transactions(org_id,customer_id,kind,credit,ref_id) values (p_org, s.customer_id, 'refund', s.balance_due, s.id);
  end if;
  update sales set status = 'void' where id = p_sale;
  insert into audit_logs(org_id,user_id,action,entity,entity_id,meta) values (p_org,auth.uid(),'sale.void','sales',p_sale,jsonb_build_object('receipt',s.receipt_no,'reason',p_reason));
end $$;
revoke all on function void_sale(uuid,uuid,text) from public, anon;
grant execute on function void_sale(uuid,uuid,text) to authenticated;

-- ── apply_inventory(): same atomic upsert as 0003, but the insufficient-stock
-- error now names the product so a cashier can act on it. ─────────────────
create or replace function apply_inventory() returns trigger language plpgsql security definer set search_path=public as $$
declare s numeric; neg boolean; pname text;
begin
  perform set_config('app.ledger','on',true);
  insert into branch_inventory(org_id,branch_id,product_id,stock_qty)
    values (new.org_id,new.branch_id,new.product_id,new.qty_change)
  on conflict (org_id,branch_id,product_id) do update set stock_qty = branch_inventory.stock_qty + excluded.stock_qty
  returning stock_qty into s;
  select allow_negative_stock into neg from organizations where id = new.org_id;
  if s < 0 and not coalesce(neg, false) then
    select name into pname from products where id = new.product_id;
    raise exception 'Insufficient stock for %', coalesce(pname, 'this product');
  end if;
  return new;
end $$;

-- ── Branch list respects branch authorization ────────────────────────────
-- 0002 let any org member list every branch. A branch-scoped user should only
-- see the branches they can actually operate on (owners/unrestricted users are
-- unaffected: can_access_branch() is true for them on every branch of the org).
-- Takes the row's own org/id (rather than re-reading the branches row) so it also
-- works for INSERT ... RETURNING, where the new row is not yet visible to a lookup.
create function branch_visible(org uuid, b uuid) returns boolean language sql stable security definer set search_path=public as $$
  select role_in(org) is not null and (
    not exists (select 1 from branch_members bm join branches br on br.id = bm.branch_id where br.org_id = org and bm.user_id = auth.uid())
    or exists (select 1 from branch_members bm where bm.branch_id = b and bm.user_id = auth.uid())
  )
$$;
grant execute on function branch_visible(uuid, uuid) to authenticated;
drop policy if exists branch_sel on branches;
create policy branch_sel on branches for select using (branch_visible(org_id, id));
