# AiroLink POS - Changelog

All notable project development milestones are recorded here.

---

# 2026-09-30 (Phase 4: Customers, Suppliers, Purchases + POS margin/tax)

## Database (`0007_phase4_suppliers_purchases.sql`, additive)
- `suppliers` (org-scoped contact master: name, contact_person, phone, email, address, is_active; `unique(id,org_id)` for tenant-safe FKs) with RLS (select: member; insert/update: owner/manager/inventory_officer/super_admin; no DELETE — deactivation only, same model as products).
- `purchases` (org + branch + supplier via composite FKs, `ref_no` unique/org from row-locked `org_counters` as `PO-YYMMDD-NNNNN`, status `draft/received/cancelled`, server-computed total, note, received_at) and `purchase_items` (product, qty>0, unit_cost≥0, line_total; unique(purchase,product); composite FKs). Both SELECT-only branch-aware RLS (items inherit branch via parent purchase, same model as sale_items); no client write policies — all writes go through the RPCs, same model as sales.
- `create_draft_purchase()` — atomic header+lines with server-computed totals; validates role, branch, active org supplier, active org products, qty/cost, no duplicate lines. Drafting never moves stock and needs no entitlement (paperwork is never trapped by a lapsed subscription).
- `receive_purchase()` — draft→received only; checks role + `is_org_entitled()` + branch access; writes `purchase` ledger entries (the existing `apply_inventory()` trigger moves branch stock; the `inv_ins` reason allowlist already excludes `purchase` so only this RPC can write it), stamps last-purchase-price onto `products.cost_price`, audits. A received purchase is immutable (like a completed sale).
- `cancel_purchase()` — draft→cancelled only, audited.
- Costing model: last-purchase-price on `products.cost_price`; historical accuracy needs NO sales-schema change because `sale_items.cost_price` snapshots and `sales.tax_total` are already persisted per sale.
- Anonymous EXECUTE denied on all three RPCs (consistent with `0005`).

## Frontend
- `Customers.tsx` (`/customers`): search, status filter, pagination, create/edit/deactivate, detail dialog with balance + credit limit (balance shown read-only — it only changes via the sales/void ledger). Reuses the existing `customers` table, preserving `credit_limit`/`balance`.
- `Suppliers.tsx` (`/suppliers`): search, status filter, pagination, create/edit/deactivate, detail dialog with contact info.
- `Purchases.tsx` (`/purchases`): supplier + receiving-branch + product lines (unit cost prefilled from current product cost, editable), live line/total preview, save-as-draft, history with ref/branch/supplier/status filters, detail dialog with receive/cancel actions for drafts. Receiving invalidates stock/cost queries (`branch_inventory`, `pos-stock`, `inv-history`, `products`, `inv-products`, `pos-search`).
- `Pos.tsx`: cart shows per-line cost + profit/margin and a cart Cost/Profit/Margin summary ONLY for roles with `viewMargin` (super_admin/owner/manager/accountant — never cashier/inventory_officer); totals block now reads Subtotal / Discount / Tax rate / Tax amount / Total. The sale itself is unchanged (server-authoritative `complete_sale()`).
- `lib/margin.ts` (pure, tested): `lineProfit`, `lineMarginPct`, `cartMargin` — zero/null-price safe, no division by zero.
- Nav/routes/permissions for customers/suppliers/purchases; dashboard quick actions extended. Query roots `suppliers`/`purchases`/`purchase` registered in `queryScope.ts` (key-convention test kept green).

## Tests
- `db.test.mjs`: +44 assertions (customer/supplier CRUD + isolation + role gates; draft atomicity/validation/cross-tenant rejection; server-computed totals; draft moves no stock; direct-write bypass rejected; receive moves the right branch only, stamps cost, keeps old sale snapshots, audits, immutable after; cancel flow; branch-scoped visibility; suspended-subscription receive block with drafting still allowed).
- Vitest: `margin.test.ts` (10) + `permissions.test.ts` (+3) — margin math, zero-price safety, role visibility.

## Deferred / limitations (unchanged)
- No supplier balances/settlement, no purchase editing after receive, no Phase 5 reports/expenses, no Phase 6 admin UI.

---

# 2026-09-29 (Phase 3 hardening: bug fixes + automatic SKU)

## POS/Sales runtime bug fixes

**Root cause (both bugs):** an organization created before migrations `0002`/`0003` existed had no main branch and no subscription row. Migration `0003_phase2_products_inventory.sql` backfills a main branch's stock/ledger and, before the point where it makes `sales.branch_id`/`inventory_transactions.branch_id` `NOT NULL`, assumed a main branch already existed — for such a pre-existing organization it did not, so those `NOT NULL` steps failed, aborting `0003` entirely (so `0004`/`0005` never applied either, leaving `sales`/`branch_inventory` in a shape the frontend's queries don't match). Separately, an organization left without a subscription row is permanently "not entitled", so `posAllowed` is false and the POS route immediately redirects to Products.

**Fix (modifies the already-committed `0003_phase2_products_inventory.sql`, not a new migration):** an idempotent backfill was added at the top of `0003` that gives every organization missing one a main branch and a 14-day trial subscription, *before* the branch-stock/ledger backfill and the `NOT NULL` steps run. For any database where `0003` already succeeded (main branch already present on every org, e.g. anything created through `create_organization()`), every `INSERT ... WHERE NOT EXISTS` here is a no-op — this is a pure bug fix with no effect on an already-correct database. I edited a historical migration only because it was genuinely broken for this real upgrade path (the project's own git history shows a pre-Phase-2 commit, `4db2a28`, so this is not a hypothetical case); the fix is documented in the migration file itself, and a new regression test (`supabase/tests/db.test.mjs`) reproduces the exact original bug — a fresh Phase-1-only database with an org/product/sale, migrated forward — and asserts both symptoms are gone and checkout still works.

**Also added:** `orgContext`/`AuthProvider` now carry a real load error for the branches/subscription query (`lib/errors.ts`), and `App.tsx`, `Pos.tsx`, `Sales.tsx` show that technical detail (with a working Retry) instead of a generic message, so a genuine future schema/RLS problem is visible rather than silently indistinguishable from "not entitled".

**Deployment note:** this only takes effect once the corrected migration actually runs against a given database. Since the original `0003` aborted (and Postgres/Supabase migrations that error are not marked as applied), re-running the pending migrations (`0003` onward) with this fix applies it automatically; a database that never hit this bug is unaffected.

## Automatic SKU generation
New migration `0006_auto_sku.sql`: a `BEFORE INSERT` trigger on `products` fills in `sku` (format `PRD-000001`, `PRD-000002`, …) whenever the caller leaves it null/blank, using the existing `org_counters` table — the same atomic `INSERT ... ON CONFLICT (org_id, name) DO UPDATE ... RETURNING` pattern already used for receipt numbers, so it is organization-scoped and concurrency-safe without a new sequence object. It never fires on UPDATE, so editing a product can never change its SKU, and a product that already has a SKU (explicitly supplied, or from before this migration) is left exactly as-is. `Products.tsx` no longer has a SKU input field; the generated SKU is shown read-only when editing. The existing `unique(org_id, sku)` constraint (from `0001`) continues to reject duplicates.

## Tests
`db.test.mjs`: 124 assertions (was 106) — 10 new SKU tests (generation, format, sequencing, org isolation, stability under edit, duplicate rejection, cross-org protection) and 6 regression tests that reproduce the upgrade bug against a second, independently-migrated in-memory database. Vitest: 61 tests (was 59) — 2 new tests for `orgContext` error surfacing.

Verification: `npm run test:db` → 124/124 PASS · `npx vitest run` → 8 files, 61/61 · `npx tsc --noEmit` → clean · `npm run build` → succeeds.

---

# 2026-09-28 (recovery + hardening)

## Phases 1–3 recovered into the repository and verified as one system

Phase 2 and Phase 3 (and the Phase 1 re-baseline) had been built in a working environment and were not in Git. They were recovered from that working tree on top of `297a8ea` (recovery reference branch: `recovery/phase1-before-phase23-recovery`; an external patch/tarball backup was also taken) and verified together from a clean database.

### Client cache isolation (TanStack Query)
- Root cause: query keys already contained organization/branch ids, but nothing removed or refetched entries on a context change (with `staleTime: 15s`, previous-context or previous-user data could reappear un-refetched), sign-out never cleared the cache, `AuthProvider` kept the previous organization's branch/subscription in state after `switchOrg` until an async load finished (and a slow response could overwrite a newer switch), and page-local state (e.g. an open stock-adjust dialog with the old branch's quantity) survived switches.
- Fix: `lib/queryScope.ts` + `ContextCacheSync` (targeted remove/invalidate; full clear on user change), atomic org context in `AuthProvider` (`lib/orgContext.ts`, request-numbered loads, `contextLoading`), route/page remount keys, and a source-scanning test that enforces the key convention. See ARCHITECTURE.md §5.5.

### Database
- New `0005_restrict_helper_execute.sql`: `role_in`, `can`, `can_access_branch`, `branch_visible`, `is_org_entitled` are no longer executable by `anon`/`public` (defense in depth; previously an anonymous caller could probe an organization's subscription state with `is_org_entitled(<uuid>)`).
- Fixed `supabase/seed_demo.sql`, which Phase 2 had broken (it wrote the removed `products.min_stock` and branch-less ledger rows). It now seeds the main branch and is exercised by the DB tests.
- Migration chain audit on a fresh database: 0001→0005 apply cleanly; every public table has RLS; no function overloads; every `SECURITY DEFINER` function pins `search_path`; `org_counters` has RLS with no policies on purpose (deny-all to clients).

### Documentation
- README rewritten (it still described the v0.1 foundation and told users to apply only `0001_core.sql`, which yields a broken app).

### Tests
- DB: 106 assertions (adds anonymous-execute denial, demo seed, and a full cross-phase lifecycle: entitlement → two branches → product/stock → split-payment sale → failed oversell → history → cross-org invisibility → subscription lockout → void → ledger).
- Vitest: cache-scope behaviour with a real `QueryClient` (including real observers proving fresh-cached queries are refetched), org-context derivation, key-convention scan. Mutation checks confirmed these fail when the protections are removed.

### Known limitations
- Not tested against a live Supabase project (no credentials in this environment); the in-memory PGlite Postgres runs the same migrations and policies.
- No DOM/component rendering tests (node-only test environment): behaviour is covered through pure modules and server rendering.
- True simultaneous-transaction concurrency cannot be simulated in PGlite; safety relies on Postgres row locking (documented).
- Refunds/partial returns, stored cash change, billing provider, branch-membership admin UI remain deferred.

---

# 2026-09-28

## Phase 3 - POS, Sales, Payments & Receipts

### Database (`0004_phase3_pos_sales.sql`, additive)
- `sales`, `sale_items`, `payments` SELECT policies are now branch-aware (`can_access_branch(sales.branch_id)`); items/payments inherit branch context through their parent sale, so no new branch columns were needed. Resolves the Phase 2 org-wide sales visibility limitation.
- `branches` SELECT now uses `branch_visible(org_id, id)`: a branch-scoped user only lists branches they can access (written to also work with `INSERT ... RETURNING`).
- `void_sale(p_org, p_sale, p_reason)`: owner/manager/super_admin, branch-authorized, completed sales only; marks `void`, restores stock via `return` ledger entries, reverses credit-sale balance, audits `sale.void`. Never deletes; does not touch `payments`.
- `apply_inventory()` re-created with the same atomic upsert; insufficient-stock error now names the product.
- Indexes: `payments(sale_id)`, `sales(org_id, branch_id, created_at desc)`.
- `complete_sale()` was intentionally NOT changed: it was already atomic, branch-aware, entitlement-aware, server-authoritative on price/tax and supported split payments.

### Frontend
- `Pos.tsx` rebuilt: branch always shown, cart with editable quantity/remove/clear, stock-capped quantities (UX only), split payments, "cash received" change, credit-sale prompt, ref-guarded double-submit protection, cart kept on failure and cleared only after the server confirms, receipt shown on success. Cart resets when organization or branch changes.
- `Receipt.tsx` / `ReceiptDialog.tsx`: printable receipt (print CSS, 80 mm/A4); reprint re-reads the stored sale.
- `Sales.tsx`: history with receipt/date/branch/customer/payment-method/status filters, pagination, detail/reprint, void (owner/manager only).
- `lib/cart.ts`, `lib/payments.ts` (pure, tested); `permissions.ts` gains `salesHistory`, `voidSales`; friendlier error mapping.

### Tests
- `db.test.mjs`: 90 assertions (Phase 1/2 kept; Phase 3 adds split payments, negative/invalid/over-payment, price tampering, discount/tax rules, unauthorized-branch and cross-tenant sales, rollback of multi-item carts, ledger/items, duplicate receipts, branch-aware sales/sale_items/payments/branches RLS, void_sale incl. credit reversal and authorization).
- Vitest: 28 tests (cart, payments/totals, receipt rendering, permissions).

### Verification (executed)
```
npm run test:db   -> 90 PASS, 0 FAIL, exit 0
npx vitest run    -> 5 files, 28/28 passed
npx tsc --noEmit  -> clean
npm run build     -> succeeds
```

### Deferred / limitations
- Refunds and partial returns, and any physical cash/mobile-money refund on void (manual today).
- Cash change is display-only and not stored, so it is absent on reprints.
- True concurrent-transaction testing is not possible in PGlite (single connection); concurrency safety relies on Postgres row locking in `apply_inventory()` / `org_counters` and is documented, not simulated.
- No component-level (DOM) UI tests: the environment is node-only, so UI logic was extracted into pure modules and receipt output is tested via server rendering.
- Cached queries are keyed by organization/branch rather than cleared on switch.
- Changes are uncommitted.

---

# 2026-09-27

## Phase 2 - Products & Branch-Aware Inventory

Products stayed organization-scoped (identity, SKU/barcode uniqueness,
pricing, category). Stock became branch-scoped, so the same product can now
carry a different quantity at each branch of an organization.

### Database

New migration:

`supabase/migrations/0003_phase2_products_inventory.sql`

Added:

- `branch_inventory` (org_id, branch_id, product_id, stock_qty, min_stock;
  `unique(org_id,branch_id,product_id)`; composite foreign keys to
  `branches(id,org_id)` and `products(id,org_id)` so a row can never combine
  a branch/product from one organization with another organization's data)
- `can_access_branch(branch_id)` — backward-compatible branch authorization
  (unrestricted by default; scoped once a user has `branch_members` rows)
- Composite unique constraints `branches(id,org_id)` / `products(id,org_id)`
  to support the composite foreign keys above

Changed:

- `products.stock_qty` / `products.min_stock` (organization-wide) were
  **removed**. Their values were copied into a `branch_inventory` row at
  each organization's main branch first — no data was lost or fabricated.
- `apply_inventory()` now upserts `branch_inventory` instead of updating
  `products` directly; still enforces `allow_negative_stock` per organization.
- A new `guard_branch_inventory()` trigger blocks direct client writes to
  `branch_inventory.stock_qty`, replacing the old guard that covered
  `products.stock_qty`.
- `inventory_transactions` and `sales` both gained a `branch_id` (composite
  FK to `branches(id,org_id)`); existing rows were backfilled to each
  organization's main branch.
- `complete_sale(p_org, p_branch, p_items, p_payments, p_customer, p_discount)`
  — added the `p_branch` parameter; validates the branch belongs to the
  organization and that the caller can access it, records it on the sale,
  and deducts stock from that branch only. The old 5-argument overload was
  dropped (not left running alongside the new one).
- RLS on `inventory_transactions` (select/insert) rewritten to also require
  `can_access_branch(branch_id)`. RLS added on `branch_inventory`
  (select/insert/update, same branch+role check).

### Frontend

- `Products.tsx` rewritten: full product CRUD (create/edit, not just
  create), category management (create/rename/safe delete), search by
  name/SKU/barcode, category filter, active/inactive filter, sortable
  columns, pagination. Stock is no longer shown or editable here — see
  Inventory.
- `Inventory.tsx` (new): branch selector (only shown when a user has more
  than one branch), stock table with low/out-of-stock status, per-branch
  editable minimum stock, a stock-adjustment workflow (opening / adjustment
  / damaged / expired / count) with notes, and branch-filtered inventory
  history.
- `Pos.tsx`: product search and stock lookup are now two queries (products
  by org, stock by org+branch) merged client-side, since stock is no longer
  a column on `products`; passes the current branch to `complete_sale()`.
- `App.tsx`: added the Inventory nav link (gated by the new `inventory`
  permission); a branch selector also appears directly in the POS page.
- `permissions.ts`: added `inventory` (view) and `adjustInventory` (write)
  permission groups, mirroring the database role checks.

### Testing

`supabase/tests/db.test.mjs` rewritten to load all three migrations, keep
every Phase 1 assertion (updated for the new branch-aware `complete_sale()`
signature and `branch_inventory` in place of `products.stock_qty`), and add
Phase 2 coverage: independent per-branch stock for the same product,
adjustment/damaged/expired/count all affecting only the targeted branch,
atomic negative-stock rejection, cross-organization branch/product attacks
rejected by the composite foreign keys, a `branch_members`-scoped user
blocked from an unassigned branch but allowed on their own, and a sale
correctly deducting from — and recording — the branch it was made at.
41/41 assertions pass.

Verification performed and passing at this checkpoint:

```bash
npm run test:db      # 41/41 PASS, exit 0
npx vitest run       # 2 files, 9/9 tests passed
npx tsc --noEmit      # clean
npm run build         # succeeds
```

### Documentation

Updated `CLAUDE.md`, `PROJECT_CONTEXT.md`, and `ARCHITECTURE.md` to describe
the branch-scoped inventory model and mark Phase 2 implemented.

### Known limitations / deferred

- Sales/sale_items/payments visibility remains organization-wide, not
  branch-restricted (deferred to Phase 3/5, per the instruction not to build
  the full Phase 3 POS/reporting workflow now)
- No branch-membership admin UI — `branch_members` rows are exercised by
  tests but only editable via direct table access until Phase 6
- No branch-specific pricing (explicitly out of scope per the spec)
- Working tree has these changes uncommitted; no commit or push was made

---

# 2026-09-26

## Phase 1 - SaaS Foundation Re-baselined

The six-phase master architecture (Supabase + Auth + Organizations/Tenants +
Branches + Subscription/Entitlement + RLS as Phase 1) was adopted. The
existing "Phase 1 completed" checkpoint from 2026-09-24 predates this
architecture and did not include branches or a subscription model, so Phase 1
was re-opened and the gaps were closed rather than left as-is or rebuilt
from scratch. Nothing from the original foundation was deleted or replaced.

### Database

New migration:

`supabase/migrations/0002_phase1_foundation.sql`

Added:

- `branches` (org-scoped, `unique(org_id, name)`, at most one `is_main` branch
  per org via a partial unique index)
- `branch_members` (branch_id, user_id) — a data-model foundation for scoping
  a user to specific branches; no admin UI yet (Phase 6)
- `plans` (seeded with `trial`, `starter`, `growth`) and `subscriptions`
  (`org_id` unique — one current subscription per organization)
- `is_org_entitled(org_id)` — `SECURITY DEFINER`, `STABLE`, checks that a
  subscription is `trialing`/`active` and inside its current window
- RLS: members can `SELECT` their org's branches/subscription; only
  `owner`/`super_admin` can write branches; there is deliberately no
  INSERT/UPDATE/DELETE policy on `plans` or `subscriptions` for authenticated
  clients — those tables only change via a security-definer RPC or the
  service role
- `create_organization()` updated (via `CREATE OR REPLACE`) to also insert a
  default "Main Branch" and a 14-day `trialing` subscription for the new org
- `complete_sale()` updated (via `CREATE OR REPLACE`, logic otherwise
  unchanged) to call `is_org_entitled()` and reject the sale before touching
  stock if the organization is not entitled

### Frontend

- `AuthProvider` rewritten to load every `organization_members` row for the
  signed-in user (previously `.limit(1).maybeSingle()`, which silently
  assumed one organization). Added `orgs`/`switchOrg` (persisted per browser),
  `branches`/`branch`/`switchBranch`, and `subscription`/`entitled`. The
  existing `org` shape (`id`, `name`, `taxRate`, `currency`, `role`) was kept
  identical so `Pos.tsx` and `Products.tsx` needed no changes.
- `App.tsx` now renders an organization switcher when a user belongs to more
  than one organization, and shows a banner + disables the `/pos` route when
  the current organization's subscription is not entitled. This is a UX
  convenience only — `complete_sale()` is the real gate.

### Testing

Extended `supabase/tests/db.test.mjs` (now loads both migrations) with:

- default branch + trial subscription are created with a new organization
- a newly created org is entitled; an org with an `expired` subscription is not
- cross-organization isolation: a second user cannot see or write another
  org's branches or subscription
- only one `is_main` branch is allowed per organization
- a client cannot change `subscriptions.status` directly (RLS silently
  filters the update to zero rows)
- `complete_sale()` is blocked while the subscription is expired, and
  succeeds again once it is reactivated

Also fixed two pre-existing test-infrastructure gaps called out by the
project's testing requirements:

- `db.test.mjs` now tracks failures and calls `process.exit(1)` if any
  assertion fails (previously it always exited 0 regardless of PASS/FAIL)
- `vite.config.ts` now excludes `supabase/tests/**` from vitest discovery —
  vitest was reporting `db.test.mjs` as a failed suite ("No test suite
  found") because it is a standalone script, not a vitest test file

Verification performed and passing at this checkpoint:

```bash
npm run test:db      # 24/24 PASS, exit 0
npx vitest run       # 2 files, 9/9 tests passed
npx tsc --noEmit      # clean
npm run build         # succeeds
```

### Documentation

Updated `CLAUDE.md`, `PROJECT_CONTEXT.md`, and `ARCHITECTURE.md` to describe
the re-baselined Phase 1 (branches, subscriptions, entitlement, multi-org
membership) and to stop describing Phase 1 as unconditionally "COMPLETED".

### Known issues / deferred

- No business table (products, sales, etc.) is branch-scoped yet — deferred
  per the instruction not to build the entire branch-aware application in one
  migration
- No payment-provider integration for subscription billing; the schema has
  `provider`/`provider_customer_id`/`provider_subscription_id` columns ready
  for it
- No admin UI for branch membership or subscription management (Phase 6)
- Working tree has these changes uncommitted; no commit or push was made
  (per the instruction not to commit/push unless explicitly asked)

---

# 2026-09-24

## Phase 1 - Foundation Completed

### Project Initialization

Created the AiroLink POS project using:

- React
- TypeScript
- Vite
- Tailwind CSS
- Supabase
- PostgreSQL
- React Router
- TanStack Query
- Zod

---

### Supabase Configuration

Configured the application to use:

- Supabase URL
- Supabase anonymous/public key

Environment variables are stored in `.env`.

`.env` is excluded from Git.

`.env.example` contains placeholder configuration.

The Supabase service-role key is not used by the frontend.

---

### Authentication

Implemented Supabase authentication foundation.

The authenticated user can enter the application through the login flow.

---

### Organization Onboarding

Implemented first-time organization onboarding.

The authenticated user can create an organization and become its owner.

Database function:

`create_organization()`

An initial issue occurred because the local migration existed but had not yet been applied to the Supabase cloud database.

The complete `0001_core.sql` migration was subsequently applied through the Supabase SQL Editor.

After migration deployment, organization onboarding worked correctly.

---

### Database

Created core migration:

`supabase/migrations/0001_core.sql`

The migration contains the initial application schema and security foundation.

Core tables include:

- organizations
- profiles
- organization_members
- categories
- products
- customers
- customer_transactions
- org_counters
- sales
- sale_items
- payments
- inventory_transactions
- audit_logs

Core helper/business functions include:

- role_in()
- can()
- touch()
- create_organization()
- complete_sale()

---

### Roles

Implemented application role model:

- super_admin
- owner
- manager
- cashier
- inventory_officer
- accountant

---

### Permission Foundation

Created frontend permission definitions.

Current permission areas include:

- POS access
- product access
- product editing

The frontend uses role-based navigation and permissions.

Database RLS remains the authoritative security layer.

---

### Application Routes

Current application routes include:

- Login
- Onboarding
- Products
- POS

---

### Git Repository

Initialized Git.

Default branch:

`main`

GitHub repository:

`AS4738129/AiroLink-POS`

Initial Phase 1 code was pushed successfully.

Repository status at checkpoint:

Clean working tree.

---

### Phase 1 Checkpoint

Status:

COMPLETED

The application is now ready for Phase 2 development.

---

# Next Phase

## Phase 2 - Products and Inventory

Status:

PLANNED

Planned work:

- product CRUD
- categories
- product search
- SKU management
- barcode management
- product pricing
- cost pricing
- product images
- inventory dashboard
- stock quantities
- low-stock detection
- opening stock
- stock adjustments
- stock counts
- inventory history
- inventory ledger
- role permissions
- RLS
- secure inventory RPCs
- audit logging
- database indexes
- tests
- production-quality validation

Important Phase 2 security objective:

Prevent unauthorized direct modification of product stock quantities.

Important implementation requirement:

Inventory-changing operations must be controlled by secure server-side business logic.

Do not implement Phase 3 POS/sales functionality as part of Phase 2 unless explicitly requested.

---

# Development Notes

## Important

This project is intended to become a real production SaaS/POS product.

Avoid demo-only implementations.

Do not introduce:

- fake statistics
- fake transactions
- localStorage business persistence
- hardcoded inventory
- hardcoded sales
- insecure client-side authorization
- exposed Supabase service-role credentials

All business-critical data must eventually be backed by Supabase PostgreSQL.

---

# Changelog Rules

Every completed development phase should update this file.

Each entry should record:

- date
- phase
- features implemented
- database migrations
- important security changes
- important architecture decisions
- tests performed
- deployment status
- known issues

Do not record planned features as completed.

Only document functionality that actually exists in the repository.
