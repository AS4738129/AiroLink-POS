# AiroLink POS

Cloud POS and inventory system for Ghanaian businesses (default currency GHS). React + TypeScript + Vite + Tailwind on the front end; Supabase (PostgreSQL, Auth, RLS) as the only backend. No localStorage database, no mock data.

## Status: foundation release (v0.1)
**Built and working:** email/password auth (sign-up, sign-in, reset, session persistence), business onboarding, multi-business isolation, six roles, products (create, search, paginate, deactivate, opening stock), inventory ledger, POS (debounced search, USB barcode scan, cart, discount, tax, split-ready payments, walk-in or credit customer), atomic `complete_sale`, audit log writes.
**Not built yet (roadmap):** dashboard, categories/customers/suppliers screens, purchases, expenses, reports, returns/refunds, receipts (print/PDF), user management UI, settings UI, camera scanning, PWA/offline. The schema already has the tables for customers, ledgers, audit; purchases, suppliers, expenses and refunds need a second migration.

## Architecture
- `supabase/migrations/0001_core.sql`: tables, indexes, triggers, RLS, and two RPCs (`create_organization`, `complete_sale`).
- Stock and customer balances can only change through the ledger (trigger-guarded). Sales/payments cannot be inserted by clients; only `complete_sale` (security definer) writes them, inside one transaction, with prices and tax computed from the database.
- Every row carries `org_id`; RLS checks membership and role with `role_in()` / `can()`.
- Front end: `src/lib` (supabase client, pure calc, permissions), `src/features/auth`, `src/pages`.

## Setup
1. Create a project at supabase.com.
2. Apply the schema: `supabase link --project-ref <ref> && supabase db push` (or paste `supabase/migrations/0001_core.sql` into the SQL editor).
3. Auth > Providers: enable Email. Set Site URL and redirect URLs to your domain (and `http://localhost:5173`).
4. `cp .env.example .env` and fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public values only).
5. `npm install && npm run dev`, sign up, create your business.
6. Optional dev data: edit the org id in `supabase/seed_demo.sql` and run it. Never in production.

## Commands
`npm run dev` | `npm run build` (typechecks) | `npm test` (calculation/permission tests) | `npm run test:db` (runs the migration in an in-memory Postgres and checks sale atomicity, stock, credit limit, RLS isolation).

## Deploy (Vercel)
Import the repo, framework Vite, build `npm run build`, output `dist`, add the two env vars, deploy, then add your domain and put it in Supabase Auth URL settings. `vercel.json` handles route refreshes.

## Roles
super_admin, owner, manager, cashier, inventory_officer, accountant. Cashiers sell; owner/manager/inventory officer edit products and stock; accountant/manager/owner read the audit log; only owner manages members. UI hiding is convenience; RLS enforces it.

## Security notes
Only the anon key is in the browser; never use the service_role key in the frontend. Keep `.env` out of Git. The first user to create a business becomes its owner; adding staff currently means inserting into `organization_members` (SQL) until the user-management UI exists.

## Known production risks
- Staff invitation UI missing; `super_admin` is a per-business role, not a platform role.
- Product creation with opening stock is two calls: a failure leaves a product with zero stock (safe, but visible).
- Cart preview uses JS rounding; the database total is authoritative and may differ by a cent in rare cases.
- No refunds, cancellations, receipts or purchases yet, so mistakes cannot be reversed in-app.
- Audit log covers sales, product create/price/status changes and business creation only; login and stock adjustments are not yet logged.
- Not load tested; no rate limiting beyond Supabase defaults; email confirmation/SMTP must be configured for production.
- Offline mode is not implemented; the POS shows an error and records nothing when the network fails.
