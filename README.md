# AiroLink POS

Cloud POS and inventory system for Ghanaian businesses (default currency GHS). React + TypeScript + Vite + Tailwind on the front end; Supabase (PostgreSQL, Auth, RLS) as the only backend. No localStorage database, no mock data.

## Status: Phases 1–3 (SaaS foundation, products + branch inventory, POS/sales)
**Built and working:** email/password auth; multiple businesses per user with an organization switcher; branches with per-user branch access; subscription/trial entitlement enforced in the database; six roles; organization-wide products and categories (CRUD, search, filter, sort, pagination); branch-scoped inventory (opening, adjustment, damaged, expired, count, history, per-branch minimum stock); branch-aware POS (search, USB barcode scan, cart, discount, tax, split payments, cash change, credit sales); atomic server-authoritative `complete_sale()`; printable receipts and reprint; sales history with filters; `void_sale()`; audit log writes.
**Not built yet (roadmap):** customer and supplier screens, purchases (Phase 4); dashboard, reports, expenses, profit/loss (Phase 5); user/branch-membership admin UI, audit-log UI, hardening (Phase 6); refunds/partial returns; camera scanning; PWA/offline.

## Architecture
- `supabase/migrations/` is the single source of truth for the database and must be applied **in order**: `0001_core` (schema, RLS, ledger guards), `0002_phase1_foundation` (branches, plans, subscriptions, entitlement), `0003_phase2_products_inventory` (branch inventory, branch-aware ledger/sales), `0004_phase3_pos_sales` (branch-aware sales RLS, `void_sale`), `0005_restrict_helper_execute` (helper functions callable only by signed-in users). See `ARCHITECTURE.md`.
- Products are organization-wide; stock belongs to a branch (`branch_inventory`). Stock and customer balances can only change through the ledger (trigger-guarded). Sales, items and payments cannot be written by clients; only `complete_sale` / `void_sale` (security definer) write them, inside one transaction, with prices and tax computed from the database.
- Every row carries `org_id`; RLS checks membership, role and branch access with `role_in()`, `can()`, `can_access_branch()`.
- Front end: `src/lib` (supabase client, pure calc/cart/payments logic, permissions, query-cache scoping), `src/features` (auth/organization/branch context, receipt loading), `src/components`, `src/pages`. TanStack Query keys are always `[root, orgId, …]` and the cache is kept in step with the active user/organization/branch (see `ARCHITECTURE.md` §5.5).

## Setup
1. Create a project at supabase.com.
2. Apply the schema: `supabase link --project-ref <ref> && supabase db push`, or paste **every** file in `supabase/migrations/` into the SQL editor in numeric order (0001 → 0005). Applying only 0001 gives an incomplete app.
3. Auth > Providers: enable Email. Set Site URL and redirect URLs to your domain (and `http://localhost:5173`).
4. `cp .env.example .env` and fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public values only).
5. `npm install && npm run dev`, sign up, create your business.
6. Optional dev data: edit the org id in `supabase/seed_demo.sql` (seeds the organization's main branch) and run it. Never in production.

## Commands
`npm run dev` | `npm run build` (typechecks) | `npm test` (calculation, cart, payments, receipt, permission, context/cache tests) | `npm run test:db` (applies all migrations to a fresh in-memory Postgres and checks checkout atomicity, branch stock, payments, void, entitlement, RLS tenant/branch isolation, grants and the demo seed).

## Deploy (Vercel)
Import the repo, framework Vite, build `npm run build`, output `dist`, add the two env vars, deploy, then add your domain and put it in Supabase Auth URL settings. `vercel.json` handles route refreshes.

## Roles
super_admin, owner, manager, cashier, inventory_officer, accountant. Cashiers sell; owner/manager/inventory officer edit products and stock; accountant/manager/owner read the audit log; only owner manages members. UI hiding is convenience; RLS enforces it.

## Security notes
Only the anon key is in the browser; never use the service_role key in the frontend. Keep `.env` out of Git. The first user to create a business becomes its owner; adding staff currently means inserting into `organization_members` (SQL) until the user-management UI exists.

## Known production risks
- Staff invitation and branch-membership UI missing (Phase 6): rows are managed in SQL; `super_admin` is a per-business role, not a platform role.
- No refunds or partial returns. `void_sale` restores stock and reverses credit but does not move money: returning cash/mobile money to a customer is a manual till action.
- Cash change is shown at checkout but not stored, so reprints do not show it.
- Cart preview uses JS rounding; the database total is authoritative and may differ by a cent in rare cases.
- Audit log covers sales, voids, product create/price/status changes and business creation; login and stock adjustments are not yet logged.
- Concurrency safety relies on Postgres row locking (atomic stock upsert, locked receipt counter); it is not load tested. Rate limiting is Supabase defaults; email confirmation/SMTP must be configured for production.
- No subscription billing provider is integrated; trials are created automatically and status changes are made server-side only.
- Offline mode is not implemented; the POS shows an error and records nothing when the network fails.
