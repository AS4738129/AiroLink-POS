-- AiroLink POS — Phase 5: expenses + expense categories (reports read existing data).
-- Additive; run after 0007_phase4_suppliers_purchases.sql. Never edits earlier migrations.
--
-- Design decisions:
--   - `expense_categories` is an organization-scoped master (like `categories` for products).
--     Businesses create their own categories (Rent, Utilities, Transport, Salary,
--     Marketing, Maintenance, Other, ...). Unique(org_id, name) prevents duplicates
--     per business; unique(id, org_id) supports tenant-safe composite FKs.
--   - `expenses` is org + branch scoped via composite FKs (same model as purchases/sales),
--     so a record can never combine a branch/category from one org with another org's data.
--   - Writes go through direct RLS-gated INSERT/UPDATE/DELETE (same model as
--     customers/suppliers/categories) — expenses move no stock, so no ledger RPC is needed.
--     Validation is enforced at the database level: CHECK(amount > 0), payment_method
--     allowlist (same five methods as payments), expense_date NOT NULL, plus
--     composite FKs that make cross-tenant references structurally impossible.
--   - Reports need NO schema change: revenue comes from persisted `sales.total`
--     (non-void), purchases from `purchases.total` (received only), COGS from
--     persisted `sale_items.qty x sale_items.cost_price` snapshots (historical cost,
--     never current product cost), inventory valuation from
--     `branch_inventory.stock_qty x products.cost_price`. All are read through
--     existing RLS policies, so branch/org isolation is automatic.
--   - Entitlement (`is_org_entitled()`) is NOT checked for expenses: like purchase
--     drafting, expense bookkeeping is paperwork with no stock/commercial effect and
--     must never trap a business whose subscription lapsed. Checkout protection in
--     complete_sale()/receive_purchase() is untouched.
--   - Audit: an `audit_expenses()` trigger writes expense.create/update/delete rows
--     to `audit_logs` (same table/action convention as product/purchase audits).

-- ── Expense categories ─────────────────────────────────────────────────────
create table expense_categories(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique(org_id, name),
  unique(id, org_id)
);
create index on expense_categories(org_id, name);

-- ── Expenses ───────────────────────────────────────────────────────────────
create table expenses(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  branch_id uuid not null,
  category_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  description text,
  payment_method text not null default 'cash'
    check (payment_method in ('cash','momo','card','bank','other')),
  expense_date date not null default CURRENT_DATE,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, org_id),
  -- composite FKs make cross-tenant branch/category combinations structurally impossible
  foreign key (branch_id, org_id) references branches(id, org_id) on delete cascade,
  foreign key (category_id, org_id) references expense_categories(id, org_id) on delete restrict
);
create index on expenses(org_id, branch_id, expense_date desc);
create index on expenses(org_id, category_id);
create trigger t_touch before update on expenses for each row execute function touch();

-- ── Audit trigger (same audit_logs convention as products/purchases/sales) ──
create function audit_expenses() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_logs(org_id,user_id,action,entity,entity_id,meta)
      values (new.org_id, auth.uid(), 'expense.create', 'expenses', new.id,
        jsonb_build_object('amount', new.amount, 'category_id', new.category_id, 'branch_id', new.branch_id, 'expense_date', new.expense_date));
  elsif tg_op = 'UPDATE' then
    insert into audit_logs(org_id,user_id,action,entity,entity_id,meta)
      values (new.org_id, auth.uid(), 'expense.update', 'expenses', new.id,
        jsonb_build_object('old_amount', old.amount, 'new_amount', new.amount, 'branch_id', new.branch_id));
  elsif tg_op = 'DELETE' then
    insert into audit_logs(org_id,user_id,action,entity,entity_id,meta)
      values (old.org_id, auth.uid(), 'expense.delete', 'expenses', old.id,
        jsonb_build_object('amount', old.amount, 'branch_id', old.branch_id));
  end if;
  return coalesce(new, old);
end $$;
create trigger t_audit_expenses after insert or update or delete on expenses
  for each row execute function audit_expenses();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table expense_categories enable row level security;
alter table expenses enable row level security;

-- Categories: financial roles only (owner/manager/accountant/super_admin).
-- Cashiers and inventory officers are excluded from expense management entirely
-- at the database level (same exclusion as the expenses table), so financial
-- reports stay hidden from them even through direct table access.
create policy expense_cat_sel on expense_categories for select using (can(org_id, array['owner','manager','accountant','super_admin']::app_role[]));
create policy expense_cat_ins on expense_categories for insert
  with check (can(org_id, array['owner','manager','accountant','super_admin']::app_role[]));
create policy expense_cat_upd on expense_categories for update
  using (can(org_id, array['owner','manager','accountant','super_admin']::app_role[]))
  with check (can(org_id, array['owner','manager','accountant','super_admin']::app_role[]));
create policy expense_cat_del on expense_categories for delete
  using (can(org_id, array['owner','accountant','super_admin']::app_role[]));
-- (deleting a category with expenses referencing it is rejected by the
--  ON DELETE RESTRICT foreign key — history is never orphaned silently.)

-- Expenses: branch-aware visibility restricted to financial roles
-- (owner/manager/accountant/super_admin). Cashiers and inventory officers get
-- zero rows at the database level — same precedent as audit_logs, which also
-- hides financial data from operational roles rather than relying on the UI.
create policy expenses_sel on expenses for select
  using (can(org_id, array['owner','manager','accountant','super_admin']::app_role[])
    and can_access_branch(branch_id));
-- Create/edit: owner/manager/accountant (manager cannot delete — see below).
create policy expenses_ins on expenses for insert
  with check (can(org_id, array['owner','manager','accountant','super_admin']::app_role[])
    and can_access_branch(branch_id));
create policy expenses_upd on expenses for update
  using (can(org_id, array['owner','manager','accountant','super_admin']::app_role[])
    and can_access_branch(branch_id))
  with check (can(org_id, array['owner','manager','accountant','super_admin']::app_role[])
    and can_access_branch(branch_id));
-- Delete: owner/accountant/super_admin only — managers can create and edit but
-- cannot delete (per the Phase 5 permission specification).
create policy expenses_del on expenses for delete
  using (can(org_id, array['owner','accountant','super_admin']::app_role[])
    and can_access_branch(branch_id));
