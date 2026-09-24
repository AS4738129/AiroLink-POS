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

The project is being developed in phases.

Current status:

Phase 1 - Foundation: COMPLETED

Next:

Phase 2 - Products and Inventory

Future phases:

Phase 3 - POS and Sales

Phase 4 - Customers, Suppliers and Purchases

Phase 5 - Reports, Expenses and Profit

Phase 6 - Security, Testing and Production

Stay within the currently requested phase.

Do not implement future-phase features unless explicitly requested.

---

# 7. CURRENT PHASE

## Phase 2 — Products and Inventory

The immediate development scope includes:

- product CRUD
- categories
- SKU management
- barcode management
- product search
- cost price
- selling price
- product status
- product images
- inventory page
- stock quantity
- low-stock detection
- opening stock
- inventory adjustments
- stock count
- inventory history
- inventory transaction ledger
- inventory permissions
- RLS
- secure inventory operations
- audit logging
- appropriate database indexes
- tests

Do not implement the complete Phase 3 POS workflow unless explicitly instructed.

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

New changes should use a new migration, for example:

`supabase/migrations/0002_inventory.sql`

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

- `create_organization()`
- `complete_sale()`

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
