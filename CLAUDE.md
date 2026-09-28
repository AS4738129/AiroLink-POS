# CLAUDE.md — AiroLink POS Development Instructions

## 1. Project Identity

You are working on:

AiroLink POS

Business:
AiroLink IT & Security Services Consultancy

Tagline:
Advanced Elevated Technology

GitHub Repository:
AS4738129/AiroLink-POS

Project Type:
Production-ready cloud-based Point of Sale and business management SaaS.

Local Project:
`/home/adade/Documents/POS/airolink`

---

# 2. Your Role

Act as a senior full-stack software engineer working on the existing AiroLink POS codebase.

Your responsibility is to:

- understand the existing architecture
- inspect the actual repository before making changes
- implement requested features correctly
- preserve existing functionality
- maintain security
- maintain database integrity
- maintain multi-tenant isolation
- write maintainable production-quality code
- test your work
- clearly report what was changed

Do not behave as if this is a new project.

This is an existing project that is being developed incrementally through defined phases.

---

# 3. REQUIRED CONTEXT FILES

Before making significant changes, read:

1. `CLAUDE.md`
2. `PROJECT_CONTEXT.md`
3. `ARCHITECTURE.md`
4. `CHANGELOG.md`

Then inspect the relevant source code.

These files provide project context, but the actual source code is authoritative for what currently exists.

Do not assume that a feature exists merely because it is mentioned in documentation.

Verify it in the repository.

---

# 4. INVESTIGATE BEFORE MODIFYING

Before changing code:

- inspect the relevant files
- inspect existing components
- inspect existing routes
- inspect existing hooks
- inspect existing database queries
- inspect existing permissions
- inspect Supabase migrations
- inspect tests
- understand how the existing feature works

Never speculate about code that has not been inspected.

If the user asks about a specific file, open and inspect that file first.

If the requested change affects the database, inspect the current database schema and migrations before proposing or implementing a migration.

---

# 5. DO NOT REBUILD THE PROJECT

Do not rebuild AiroLink POS from scratch.

Do not replace the current architecture simply because another architecture could be used.

Prefer modifying and extending the existing implementation.

Reuse existing:

- components
- utilities
- hooks
- types
- permission logic
- database helpers
- styling patterns
- query patterns
- routing patterns

Only introduce a new abstraction when it is genuinely necessary.

---

# 6. DEVELOPMENT PHASES

The project follows a six-phase master architecture. Current status:

Phase 1 - SaaS Foundation: IMPLEMENTED and verified.

Phase 2 - Products and Branch-Aware Inventory: IMPLEMENTED and verified.

Phase 3 - POS, Sales, Payments, Receipts: IMPLEMENTED, pending your review.

Next:

Phase 4 - Customers, Suppliers and Purchases

Phase 5 - Reports, Expenses and Profit

Phase 6 - Users/Roles, Audit, Security Hardening, Testing, Production

Stay within the currently requested phase.

Do not implement future-phase features unless explicitly requested.

---

# 7. CURRENT PHASE

## Phase 3 — POS, Sales, Payments, Receipts (implemented)

- `complete_sale()` stays the single atomic checkout (server-authoritative price/tax/total, entitlement, branch authorization, atomic branch stock deduction, credit rules); the browser sends only product ids + quantities
- Split payments (cash/momo/card/bank/other), cash change shown in the POS but never stored as a payment
- Sales/sale_items/payments reads are branch-aware; branch list is limited to accessible branches (`branch_visible()`)
- `void_sale()` (owner/manager/super_admin): status `void`, stock restored via `return`, credit reversed, audited; payments untouched
- Frontend: rebuilt `Pos.tsx` (visible branch, cart with editable qty/remove, split payments, double-submit guard, receipt on success), `Receipt.tsx`/`ReceiptDialog.tsx` (printable, reprint reads the stored sale), `Sales.tsx` (history, filters, detail, void), pure `lib/cart.ts` and `lib/payments.ts`
- Query cache: keys are `[root, orgId, …]`; `ContextCacheSync` + `lib/queryScope.ts` remove/invalidate cache on user/org/branch change; `AuthProvider` exposes org context atomically (`lib/orgContext.ts`). New queries MUST follow the key convention and be classified in `queryScope.ts` (a test enforces it)
- Deferred: refunds/partial returns and physical cash refunds, stored cash-change on reprints, customer/supplier management (Phase 4), reports (Phase 5), branch-membership admin UI (Phase 6)


## Phase 2 — Products and Branch-Aware Inventory (implemented)

What Phase 2 added on top of Phase 1:

- Products stayed organization-scoped (identity/SKU/barcode/pricing/category);
  stock moved to a new `branch_inventory` table, one row per
  (org, branch, product), replacing the old organization-wide
  `products.stock_qty`/`min_stock`
- `inventory_transactions` and `sales` both gained a `branch_id`, with
  composite foreign keys to `branches(id,org_id)`/`products(id,org_id)` so a
  record can never combine a branch/product from one organization with
  another organization's data
- `apply_inventory()` now upserts `branch_inventory`; a `guard_branch_inventory()`
  trigger blocks direct client writes to `stock_qty`, same as the old guard did
- `can_access_branch(branch_id)` — backward-compatible branch authorization:
  a user with no `branch_members` rows in an org can access every branch of
  that org (today's default); a user with explicit `branch_members` rows is
  scoped to just those branches
- `complete_sale()` now requires `p_branch`, validates it, and deducts stock
  from that branch only — the old 5-argument version was dropped, not left
  running alongside the new one
- Frontend: full product CRUD + category management in `Products.tsx`; a new
  `Inventory.tsx` (branch selector, stock table with low/out status, stock
  adjustment workflow for opening/adjustment/damaged/expired/count, and
  transaction history); `Pos.tsx` updated to look up branch-scoped stock and
  pass the current branch to `complete_sale()`

Not yet done, and intentionally deferred to later phases:

- Sales/sale_items/payments visibility is still organization-wide (not
  branch-restricted) — Phase 3/5 concern, not required for Phase 2
- No branch-membership admin UI (Phase 6) — the `branch_members` data model
  is exercised by tests but only editable via direct table access today
- No branch-specific pricing (explicitly out of scope for Phase 2)

## (Superseded) Phase 3 scope list

The immediate development scope, once Phase 2 is confirmed, includes:

- refunds/void workflow
- printable receipts
- sale history and sale detail views
- duplicate-submission protection review
- any further payment-method handling

Do not implement Phase 4/5/6 features unless explicitly instructed.

---

# 8. TECHNOLOGY STACK

Frontend:

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- TanStack Query
- Zod

Backend:

- Supabase
- PostgreSQL
- Supabase Auth
- Row Level Security
- PostgreSQL functions/RPCs
- Supabase Storage where required
- Supabase Realtime where required

Deployment:

- Vercel

Source control:

- Git
- GitHub

---

# 9. DATABASE IS AUTHORITATIVE

AiroLink POS is a real database-backed application.

Do not use:

- fake production data
- hardcoded business statistics
- localStorage as the primary database
- mock inventory for production functionality
- fake sales records
- client-only business logic

Business data must ultimately come from Supabase PostgreSQL.

---

# 10. MULTI-TENANT SECURITY

AiroLink POS is a multi-tenant application.

Businesses are represented by organizations.

Users belong to organizations through:

`organization_members`

Business records generally contain:

`org_id`

A user belonging to Organization A must never be able to access Organization B's business data.

This must be enforced through PostgreSQL Row Level Security.

Frontend filtering is NOT sufficient security.

Never rely solely on:

- hidden UI elements
- route restrictions
- JavaScript permission checks
- client-side organization IDs

Database security is authoritative.

---

# 11. ROLES

Current application roles:

- super_admin
- owner
- manager
- cashier
- inventory_officer
- accountant

Respect the existing permission system.

Do not invent new roles without explicit approval.

When adding a permission:

- update the frontend permission system where necessary
- update database authorization where necessary
- update RLS/RPC security
- test authorized and unauthorized behavior

---

# 12. SUPABASE SECURITY

Never expose:

`service_role`

credentials in frontend code.

Never place the Supabase service-role key in:

- React components
- browser JavaScript
- `.env` variables beginning with `VITE_`
- Git
- documentation
- screenshots
- public repositories

The frontend may use:

`VITE_SUPABASE_URL`

and:

`VITE_SUPABASE_ANON_KEY`

Never ask the user to paste private Supabase credentials into chat.

---

# 13. RLS REQUIREMENT

Any new organization-owned table must have appropriate RLS policies.

Before adding a database table, determine:

- who can SELECT
- who can INSERT
- who can UPDATE
- who can DELETE

Do not create a table without considering its authorization model.

Organization isolation must be enforced at the database level.

---

# 14. SECURITY DEFINER FUNCTIONS

When using PostgreSQL `SECURITY DEFINER` functions:

- use a fixed `search_path`
- explicitly validate authorization
- verify organization membership
- validate input
- expose only the required function
- grant EXECUTE only to appropriate roles

Do not create insecure RPCs that trust arbitrary client-supplied organization IDs.

Where possible, derive authorization from the authenticated user's membership.

---

# 15. INVENTORY INTEGRITY

Inventory is business-critical.

Do not allow normal users to arbitrarily modify:

`products.stock_qty`

Inventory changes must occur through controlled business operations.

Valid inventory operations include:

- opening
- purchase
- sale
- return
- adjustment
- damaged
- expired
- count

Every meaningful stock change should have an inventory transaction record.

The inventory ledger must remain auditable.

---

# 16. INVENTORY OPERATIONS

Preferred architecture:

Frontend

↓

Authorized database operation/RPC

↓

Validate authenticated user

↓

Validate organization membership

↓

Validate role

↓

Validate product

↓

Validate quantity/business rules

↓

Update stock

↓

Create inventory transaction

↓

Create audit record where appropriate

↓

Commit transaction

Do not trust the frontend to enforce critical inventory rules.

---

# 17. NEGATIVE STOCK

Respect the existing organization setting:

`allow_negative_stock`

Do not invent a different negative-stock policy.

If negative stock is disabled:

- stock-changing operations must reject transactions that would make stock negative.

If negative stock is enabled:

- the operation may proceed according to the business rules.

This must be enforced server-side.

---

# 18. TRANSACTIONS

Business-critical database operations should be atomic.

If an operation performs multiple dependent changes, prefer a PostgreSQL transaction/RPC so that the database does not end up partially updated.

Example:

Sale:

sale

+

sale_items

+

payment

+

inventory reduction

+

inventory transaction

+

customer balance update

These should be treated as one business operation.

---

# 19. DATABASE MIGRATIONS

Database schema changes must use migrations.

Existing migration:

`supabase/migrations/0001_core.sql`
`supabase/migrations/0002_phase1_foundation.sql`
`supabase/migrations/0003_phase2_products_inventory.sql`
`supabase/migrations/0004_phase3_pos_sales.sql`
`supabase/migrations/0005_restrict_helper_execute.sql`

New changes should use a new migration, for example:

`supabase/migrations/0006_customers_suppliers.sql`

Do not casually edit an already-applied production migration.

Do not drop existing tables or columns as a shortcut.

Do not make destructive database changes without explicit approval.

Before applying a migration:

- inspect the current schema
- verify dependencies
- verify RLS
- verify permissions
- verify indexes
- verify functions
- verify rollback/recovery implications

Prefer safe forward migrations.

---

# 20. DATABASE FUNCTIONS

Existing important functions include:

- `create_organization()` — also provisions a default branch and trial subscription
- `complete_sale(p_org, p_branch, ...)` — gated by `is_org_entitled()` and `can_access_branch()`; deducts stock from the given branch's `branch_inventory` row
- `is_org_entitled()` — the entitlement check every protected commercial RPC should use
- `can_access_branch()` — the branch-authorization check every branch-scoped RPC/RLS policy should use
- `void_sale()` — safe cancellation of a completed sale (no deletion)

Do not duplicate existing business logic unnecessarily.

Before creating a new function:

1. Search the repository.
2. Search existing migrations.
3. Determine whether an equivalent function already exists.
4. Extend existing functionality if appropriate.

---

# 21. FRONTEND DATA

Use Supabase for real application data.

Use TanStack Query where appropriate for:

- fetching
- caching
- mutations
- invalidation
- loading states
- error states

Do not introduce unnecessary global state.

Do not create duplicate sources of truth.

---

# 22. VALIDATION

Use Zod where appropriate for client-side validation.

However:

Client-side validation is NOT a security boundary.

Important business rules must also be enforced by:

- database constraints
- PostgreSQL functions
- RLS
- server-side validation

Examples:

- price cannot be negative
- quantity must be valid
- organization membership must be valid
- unauthorized roles must be rejected
- stock rules must be enforced server-side

---

# 23. USER EXPERIENCE

The POS is intended for real business users.

Interfaces should be:

- responsive
- clear
- fast
- practical
- easy to understand
- suitable for desktop POS environments
- usable on tablets where appropriate

Do not sacrifice business correctness for visual effects.

Avoid unnecessary animations or decorative complexity.

---

# 24. ERROR HANDLING

User-facing errors should be understandable.

Do not expose raw database internals unnecessarily.

For example, avoid showing users raw PostgreSQL errors when a clear business message can be displayed.

However, preserve useful technical details in development logs where appropriate.

Never silently ignore important database errors.

---

# 25. PERFORMANCE

The application should be designed for real business data.

Use:

- appropriate indexes
- pagination
- server-side filtering
- efficient queries
- query caching
- selective data fetching

Avoid loading thousands of database records unnecessarily.

For searchable lists, prefer server-side search/filtering when datasets can become large.

---

# 26. FILE UPLOADS

Supabase Storage may be used for product images and other business assets.

Storage policies must respect organization boundaries.

Do not make private business files publicly accessible without an explicit requirement.

Validate uploaded files appropriately.

---

# 27. TESTING

Testing is part of implementation.

Where appropriate, test:

- permissions
- RLS
- organization isolation
- inventory operations
- database functions
- validation
- important UI behavior

Do not modify production logic merely to make a test pass.

Tests should verify correct business behavior.

---

# 28. BUILD VERIFICATION

Before declaring a significant task complete, run:

```bash
npm run build
