# AiroLink POS - Architecture

## 1. Architecture Overview

AiroLink POS is a cloud-based, multi-tenant Point of Sale and business management platform.

High-level architecture:

User
  ↓
React + TypeScript frontend
  ↓
Supabase client
  ↓
Supabase Auth
  ↓
PostgreSQL + RLS + RPC functions
  ↓
Business data

Additional services:

React Application
  ↓
Vercel

Supabase
  ├── Authentication
  ├── PostgreSQL
  ├── Row Level Security
  ├── Database Functions
  ├── Storage
  └── Realtime where required

---

## 2. Frontend Architecture

Framework:

React + TypeScript + Vite

The frontend is responsible for:

- user interface
- routing
- form handling
- validation
- displaying business data
- user experience
- role-aware navigation
- calling authorized Supabase operations

The frontend is NOT the final security boundary.

All sensitive authorization and business-critical database operations must be enforced server-side.

---

## 3. Routing

React Router is used for application navigation.

Current application areas include:

- Login
- Onboarding
- Products
- POS

Future routes will include:

- Dashboard
- Inventory
- Customers
- Suppliers
- Purchases
- Expenses
- Reports
- Settings
- Users/Staff
- Audit Logs

Routes should be protected based on authentication and organization membership.

---

## 4. Authentication

Authentication is handled by Supabase Auth.

The authenticated user's identity is obtained from Supabase.

Application profile information is stored in:

`profiles`

Organization membership is stored in:

`organization_members`

Relationship:

auth.users
    ↓
profiles

auth.users
    ↓
organization_members
    ↓
organizations

---

## 5. Multi-Tenant Model

The application is multi-tenant.

Each business is an organization. An organization has one or more branches, and belongs to exactly one subscription record that gates access to protected commercial operations.

Example:

Organization A
- Subscription (trialing/active/...)
- Branches (Accra, Kumasi, ...)
- Users
- Products
- Customers
- Sales
- Inventory

Organization B
- Subscription (trialing/active/...)
- Branches (Main, ...)
- Users
- Products
- Customers
- Sales
- Inventory

Data must never leak between organizations.

Most business tables contain:

`org_id`

RLS policies use organization membership to control access.

A user may belong to more than one organization, each with its own role. The frontend must never assume a user has exactly one organization (do not query membership with `.limit(1)`); it loads every membership row and lets the user switch between organizations.

---

## 5.1 Branches

Branches represent physical or logical locations within an organization (e.g. "Accra Branch", "Kumasi Branch").

```
organizations
    │
    ├── branches (org_id FK, unique(org_id, name), one is_main per org)
    └── branch_members (branch_id, user_id) — foundation for scoping a user
        to specific branches; full admin UI is a Phase 6 concern.
```

Every organization gets a default "Main Branch" automatically when it is created (see `create_organization()`).

---

## 5.3 Branch-Scoped Inventory (Phase 2)

Products are organization-scoped (identity, SKU/barcode uniqueness, pricing, category all live on `products`, keyed by `org_id`). Stock is branch-scoped:

```
products                 branch_inventory                 inventory_transactions
---------                ----------------                 -----------------------
id                       id                                id
org_id                   org_id                            org_id
category_id              branch_id  ─┐                     branch_id  ─┐
sku, barcode, name       product_id ─┼─ composite FKs       product_id ─┼─ composite FKs
cost_price, ...          stock_qty   │  to (id,org_id) on   qty_change  │  to (id,org_id) on
                         min_stock  ─┘  branches & products  reason, ref─┘  branches & products
                         unique(org_id,branch_id,product_id)
```

`branch_inventory.stock_qty`/`min_stock` replaced the old `products.stock_qty`/`min_stock` (organization-wide) columns in migration `0003_phase2_products_inventory.sql`; the values were carried over to each organization's main branch rather than lost, and the columns were dropped from `products` once copied. Minimum stock is branch-specific (a product's healthy stock level can differ by branch), so it was moved rather than duplicated.

The `apply_inventory()` trigger on `inventory_transactions` now upserts `branch_inventory` (`INSERT ... ON CONFLICT (org_id,branch_id,product_id) DO UPDATE`) instead of updating `products` directly, and still refuses to let stock at a branch go negative unless that organization's `allow_negative_stock` is set. A `guard_branch_inventory()` trigger blocks any direct client write to `stock_qty` outside the ledger, exactly like the old products guard did.

`complete_sale(p_org, p_branch, p_items, p_payments, p_customer, p_discount)` now takes an explicit branch, validates it belongs to the organization and that the caller can access it, records it on the `sales` row, and deducts stock from that branch's `branch_inventory` row. The old 5-argument version (without a branch) was dropped rather than left running alongside the new one.

### Branch access model

`can_access_branch(branch_id)` is the single check used everywhere branch authorization matters (RLS on `branch_inventory`/`inventory_transactions`, and inside `complete_sale()`). It is backward compatible with Phase 1: a user with **no** `branch_members` rows in an organization has access to every branch of that organization (today's default, since nobody has been branch-restricted yet); a user who **does** have one or more `branch_members` rows is scoped to exactly those branches. This lets a future Phase 6 admin screen restrict specific staff to specific branches without any further schema change.

---

## 5.2 Subscription / Entitlement

Account creation does not grant unrestricted commercial access. Each organization has exactly one `subscriptions` row (created as `trialing` for 14 days by `create_organization()`), and every protected commercial operation checks entitlement server-side:

```
Authenticated       →  Authorized role      →  Subscription entitled  →  Operation allowed
     (auth.uid())        (role_in/can())         (is_org_entitled())
```

`is_org_entitled(org_id)` is a `SECURITY DEFINER` SQL function checked inside `complete_sale()`; clients cannot write to `subscriptions` or `plans` directly (no INSERT/UPDATE/DELETE RLS policy exists for either table — only a platform-level process or a future billing RPC can change subscription state). Frontend `entitled` state (in `AuthProvider`) mirrors this for UX (disabling the POS route, showing a banner) but is never the actual gate.

## 5.4 POS, Sales, Payments, Receipts (Phase 3)

`complete_sale(p_org, p_branch, p_items, p_payments, p_customer, p_discount)` (introduced in 0003) already was the single atomic checkout; Phase 3 kept it as the only checkout path and did not add a competing RPC. In one transaction it: verifies the caller's role, `is_org_entitled()`, that the branch belongs to the organization and `can_access_branch()`; loads every product's price/taxable flag from the database (the browser sends only product ids and quantities, so a tampered price is ignored); computes subtotal, discount, tax and total in `numeric`; locks and increments the organization's receipt counter; inserts the sale, items and payments; writes `sale` ledger entries that deduct that branch's `branch_inventory` (an atomic upsert that row-locks, so concurrent cashiers cannot oversell); applies credit rules for any unpaid remainder; writes the audit record. Any failure rolls back everything.

Payments: `payments.method` is constrained to cash/momo/card/bank/other. Several lines per sale (split payment) are supported and summed. The server rejects non-positive amounts, unknown methods and `sum(payments) > total`; an unpaid remainder requires a customer and passes the credit-limit check (credit sale). Cash "change" is never stored or counted as revenue: the POS sends only the amount applied to the bill and shows change from the "cash received" field. Because change is not stored, a reprint does not show it.

Receipts: numbers are `R-YYMMDD-NNNNN` from `org_counters` (organization-level, not per branch); `unique(org_id, receipt_no)` backs it up. `Receipt.tsx` is a purely presentational view (tenant business name, branch, cashier, items, totals, payments); `ReceiptDialog` loads the stored sale by id/number under RLS, so reprinting never creates or edits a sale. Print CSS in `index.css` prints only the receipt (80 mm wide, also fine on A4).

Visibility: `sales`, `sale_items` and `payments` selects are branch-aware (`can_access_branch(sales.branch_id)`; items/payments inherit branch context through their parent sale rather than duplicating a branch column). There are still no client INSERT/UPDATE/DELETE policies on them, so all writes go through the RPCs. `branches` selects use `branch_visible(org_id, id)` so a branch-scoped user only lists branches they can access.

Void: `void_sale(p_org, p_sale, p_reason)` (owner/manager/super_admin, branch-authorized, completed sales only) marks the sale `void` (never deletes it), restores stock with `return` ledger entries, reverses any credit-sale balance with a `refund` customer transaction, and audits `sale.void`. It does not touch `payments` or move money: returning cash/mobile money is a manual till action, so refunds/partial returns remain a later-phase feature.

---

## 5.5 Client cache isolation (TanStack Query)

The database is the security boundary; this layer only guarantees that the UI never shows one organization's or branch's data as another's.

- Convention: every query key is `[root, orgId, …]`; branch-scoped stock/history keys are `[root, orgId, branchId, …]`. Roots are classified in `src/lib/queryScope.ts` (org-only, branch-keyed, branch-dependent) and `queryScope.test.ts` fails if a query in `src/pages`/`src/components` breaks the convention or uses an unclassified root.
- `AuthProvider` stores branches, current branch and subscription as ONE object tagged with the organization it was loaded for; what the app sees is derived from it (`lib/orgContext.ts`), so there is never a render pairing the new organization with the previous one's branch or subscription. Loads are request-numbered so a slow response for a previous organization is dropped. While the new organization's context loads, `contextLoading` is true and the app shows a loading state instead of deciding on unknown entitlement. `switchBranch` accepts only branches the database returned for the current organization.
- `ContextCacheSync` (renders nothing) calls `applyContextChange()` whenever user, organization or branch changes:
  - user changed or signed out: cancel and clear the whole cache;
  - organization changed: cancel and remove every cached query of the previous organization only (other cached data is untouched), then invalidate the new organization's queries;
  - branch changed: remove the previous branch's stock/history entries and invalidate branch-keyed and branch-dependent queries (stock, history, sales, POS availability); organization-level data (products, categories, customers, policy) is neither removed nor invalidated, preserving useful cache.
  Invalidation uses `cancelRefetch: false`, so an in-flight fetch for the same key is reused rather than restarted.
- `App.tsx` remounts the routes on organization change (`key={org.id}`) and the POS and Inventory pages on branch change, so page-local state (cart, open stock-adjust dialog holding the old branch's quantity, filters, open receipt) cannot carry across contexts.
- `localStorage` stores only the remembered organization/branch id as a UI preference and is validated against what the database returned.

---

## 6. Authorization

Application roles:

- super_admin
- owner
- manager
- cashier
- inventory_officer
- accountant

There are two authorization layers.

### Frontend Authorization

Used to:

- show/hide navigation
- disable actions
- improve user experience
- prevent users from attempting unauthorized actions

### Database Authorization

Used to actually protect data.

Implemented through:

- RLS
- PostgreSQL functions
- role checks
- organization membership checks

Frontend authorization must never be treated as sufficient security.

---

## 7. Database Architecture

Database:

PostgreSQL through Supabase.

Core entities:

organizations
profiles
organization_members
branches
branch_members
plans
subscriptions
categories
products
branch_inventory
customers
customer_transactions
org_counters
sales
sale_items
payments
inventory_transactions
audit_logs

Future entities may include:

suppliers
purchases
purchase_items
expenses
expense_categories
refunds
stock_counts
stock_count_items
staff
notifications
settings

Database changes must be introduced through migrations.

Migration naming:

`0001_core.sql`

`0002_phase1_foundation.sql` (branches, branch_members, plans, subscriptions, is_org_entitled())

`0003_phase2_products_inventory.sql` (branch_inventory, branch-aware inventory_transactions/sales/complete_sale(), can_access_branch())

`0004_phase3_pos_sales.sql` (branch-aware sales/sale_items/payments/branches RLS, void_sale(), product-named stock error, payment/sales indexes)

`0005_restrict_helper_execute.sql` (authorization helper functions executable only by `authenticated`, not `anon`/`public`)

Future examples:

`0006_customers_suppliers.sql`

etc.

---

## 8. Product Model

Products belong to an organization.

Important fields include:

- id
- org_id
- category_id
- SKU
- barcode
- name
- description
- brand
- unit
- cost_price
- selling_price
- taxable
- stock_qty
- min_stock
- image_url
- is_active
- created_at
- updated_at

SKU uniqueness is organization-specific.

Barcode uniqueness is organization-specific.

---

## 9. Inventory Architecture

Inventory should be ledger-driven.

The current stock quantity is stored on the product for efficient reads.

Inventory changes are recorded in:

`inventory_transactions`

Reasons include:

- opening
- purchase
- sale
- return
- adjustment
- damaged
- expired
- count

Conceptually:

Opening Stock
     ↓
Inventory Ledger
     ↓
Current Product Stock

Purchase
     ↓
Inventory Ledger
     ↓
Stock increases

Sale
     ↓
Inventory Ledger
     ↓
Stock decreases

Adjustment
     ↓
Inventory Ledger
     ↓
Stock changes

The ledger provides an auditable history of stock changes.

---

## 10. Inventory Security

Normal application users should not be able to arbitrarily modify stock quantity.

Inventory changes should be controlled by authorized business operations.

Preferred model:

Frontend
  ↓
Authorized RPC
  ↓
Authorization check
  ↓
Database transaction
  ↓
Update product stock
  ↓
Insert inventory transaction
  ↓
Audit log

Where appropriate, database constraints/triggers/permissions should prevent bypassing the intended inventory workflow.

---

## 11. Sales Architecture

Sales consist of:

sales
sale_items
payments

A sale may optionally reference a customer.

A completed sale should perform its critical operations atomically.

Conceptual flow:

POS
 ↓
Validate user
 ↓
Validate organization
 ↓
Validate products
 ↓
Validate stock
 ↓
Create sale
 ↓
Create sale items
 ↓
Create payment
 ↓
Reduce stock
 ↓
Create inventory transactions
 ↓
Update customer balance if applicable
 ↓
Audit
 ↓
Commit

If a critical operation fails, the transaction should roll back.

---

## 12. Database RPC Functions

Business-critical operations should use secure PostgreSQL functions where appropriate.

Existing important functions include:

`create_organization()` — creates the organization, the owner membership, a default main branch, and a 14-day trialing subscription.

`complete_sale(p_org, p_branch, p_items, p_payments, p_customer, p_discount)` — the atomic checkout RPC; requires `is_org_entitled(org_id)` and `can_access_branch(p_branch)` to pass, and deducts stock from `branch_inventory` at that branch.

`is_org_entitled()` — `SECURITY DEFINER`, stable, checks whether an organization's subscription is currently `trialing`/`active` and inside its window. Every future protected commercial RPC should call this rather than re-implementing the check.

`can_access_branch(branch_id)` — `SECURITY DEFINER`, stable, the single branch-authorization check used by RLS and by `complete_sale()`. See §5.3.

Future inventory functions may include operations such as:

- create/opening stock
- adjust stock
- perform stock count
- receive purchase
- process return

Functions must:

- validate authorization
- validate organization membership
- validate input
- use safe search_path settings when SECURITY DEFINER is used
- avoid trusting client-supplied authorization information
- expose only required execution privileges

---

## 13. Row Level Security

RLS is a fundamental security layer.

Every organization-owned table should have appropriate policies.

Typical model:

User
 ↓
organization_members
 ↓
organization
 ↓
organization-owned records

Policies must ensure:

SELECT:
User can only read records belonging to organizations they belong to.

INSERT:
User can only create records for authorized organizations.

UPDATE:
User can only update records they are authorized to modify.

DELETE:
User can only delete records they are authorized to delete.

Business-critical operations may be implemented through RPC functions rather than direct table writes.

---

## 14. Audit Logging

Important business actions should be auditable.

`audit_logs` should record relevant events such as:

- login/security events where appropriate
- product changes
- inventory adjustments
- stock counts
- sales
- refunds
- user/role changes
- configuration changes

Audit logs should not be casually editable by normal application users.

---

## 15. Storage

Supabase Storage may be used for:

- product images
- organization branding
- receipt assets where necessary
- other business documents where required

Storage policies must also respect organization boundaries.

Do not expose private business files through unrestricted public storage unless the data is intentionally public.

---

## 16. Data Fetching

TanStack Query should be used where appropriate for:

- server state
- caching
- loading states
- mutation handling
- refetching

Do not introduce unnecessary global state.

Business data should come from Supabase rather than hardcoded arrays.

---

## 17. Validation

Zod should be used for important client-side input validation.

However:

Client-side validation is not sufficient for security.

Database functions and constraints must also validate important business rules.

Examples:

- prices cannot be negative
- quantities must be valid
- organization membership must be valid
- unauthorized roles cannot perform restricted operations
- stock rules must be enforced server-side

---

## 18. Performance

The system should be designed for real businesses.

Important practices:

- database indexes on frequently searched fields
- organization-aware queries
- pagination for large lists
- server-side filtering where appropriate
- avoid loading thousands of records unnecessarily
- TanStack Query caching where appropriate
- efficient PostgreSQL queries

Likely search fields:

- SKU
- barcode
- product name
- customer name
- customer phone
- supplier name
- invoice/reference numbers

---

## 19. Deployment Architecture

Production:

User
 ↓
Vercel
 ↓
React application
 ↓
Supabase
 ↓
PostgreSQL

GitHub:

AS4738129/AiroLink-POS

Recommended workflow:

Local development
 ↓
Git commit
 ↓
GitHub main
 ↓
Vercel deployment

Database:

Local migration files
 ↓
Reviewed migration
 ↓
Supabase SQL / migration deployment
 ↓
Production database

---

## 20. Environment Separation

Never commit secrets.

Local:

`.env`

Production:

Vercel environment variables

Supabase secrets/configuration:

Supabase dashboard / secure environment configuration

Public frontend variables:

`VITE_SUPABASE_URL`

`VITE_SUPABASE_ANON_KEY`

Never expose:

`SUPABASE_SERVICE_ROLE_KEY`

in frontend code.

---

## 21. Testing Strategy

Testing should cover:

### Unit Tests

- permission logic
- validation
- utility functions

### Database Tests

- RLS isolation
- organization isolation
- role permissions
- inventory operations
- transaction integrity

### Integration Tests

- authentication
- organization onboarding
- product creation
- inventory changes
- sales

### Build Tests

```bash
npm run build
