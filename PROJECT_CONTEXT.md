# AiroLink POS - Project Context

## Project Identity

Project Name: AiroLink POS

Developer/Business: AiroLink IT & Security Services Consultancy

Tagline: Advanced Elevated Technology

Repository: AS4738129/AiroLink-POS

Project Type: Cloud-based Point of Sale and Business Management System

Primary Goal:
Build a production-ready, multi-business POS/SaaS platform that AiroLink can deploy for small and medium-sized businesses.

The system must be a real application connected to a real PostgreSQL database through Supabase. It must not depend on fake data, localStorage-based business logic, hardcoded dashboard statistics, or demo-only workflows.

---

## Current Development Status

Current Phase: Phase 1 - Foundation

Phase 1 status: COMPLETED

Phase 1 checkpoint:
- Application runs locally with Vite.
- Supabase authentication is configured.
- Supabase database schema has been applied.
- Organization onboarding works.
- User can create their business organization.
- Role-based permissions foundation exists.
- Products and POS routes exist.
- Git repository is initialized.
- Main branch is pushed to GitHub.
- Working tree is currently clean.

Git branch:
main

GitHub repository:
AS4738129/AiroLink-POS

Local project:
`/home/adade/Documents/POS/airolink`

---

## Technology Stack

Frontend:
- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- TanStack Query
- Zod

Backend / Infrastructure:
- Supabase
- PostgreSQL
- Supabase Auth
- Row Level Security (RLS)
- Supabase RPC/database functions
- Supabase Storage where required
- Supabase Realtime where required

Deployment:
- Vercel

Source control:
- Git
- GitHub

---

## Environment Variables

Frontend uses public Supabase configuration:

VITE_SUPABASE_URL

VITE_SUPABASE_ANON_KEY

The `.env` file must never be committed.

The Supabase `service_role` key must NEVER be placed in frontend environment variables or client-side code.

`.env.example` contains placeholder values.

---

## Database

Primary database:
Supabase PostgreSQL

Current migration:

`supabase/migrations/0001_core.sql`

The migration contains the core application schema, including:

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

It also contains security/helper functions including:

- role_in()
- can()
- touch()
- create_organization()
- complete_sale()

The database uses UUIDs and PostgreSQL functions for important transactional operations.

---

## Multi-Tenant Architecture

AiroLink POS is intended to support multiple businesses.

Each business is represented by an organization.

Users belong to organizations through:

`organization_members`

The organization membership contains the user's application role.

All business data must be isolated by organization.

Important rule:

A user belonging to Organization A must never be able to read or modify Organization B's data.

RLS must enforce this at the database level.

Frontend permission checks are useful for UI behavior but are NOT considered sufficient security.

---

## Application Roles

Current roles:

- super_admin
- owner
- manager
- cashier
- inventory_officer
- accountant

Permissions must be enforced through both:

1. Frontend authorization for user experience
2. Database RLS/RPC authorization for actual security

---

## Important Security Rules

Never trust organization IDs supplied by the browser for authorization.

Where possible, secure database functions should determine the organization from the authenticated user's membership rather than trusting a client-supplied organization ID.

SECURITY DEFINER functions must:

- use a fixed search_path
- perform explicit authorization checks
- only expose required functionality
- have appropriate EXECUTE permissions

Authenticated users may call authorized application functions.

Anonymous users must not be able to execute privileged business functions.

---

## Inventory Integrity

Inventory is financially and operationally important.

The system must maintain a reliable inventory ledger.

Stock quantity must not be freely editable by normal users.

Inventory changes should happen through controlled business operations such as:

- opening stock
- purchase
- sale
- return
- adjustment
- damaged stock
- expired stock
- stock count

Each stock-changing operation should produce an appropriate inventory transaction.

Direct manipulation of `products.stock_qty` by normal application users must be prevented where possible.

---

## Sales Integrity

Completing a sale must be an atomic server-side operation.

A completed sale should correctly handle:

1. Sale record
2. Sale items
3. Payment
4. Inventory reduction
5. Inventory transaction
6. Customer balance where applicable
7. Audit logging where applicable

If one critical operation fails, the transaction should not leave the database in a partially completed state.

---

## Current Frontend

Current main application routes/features include:

- Login
- Organization onboarding
- Products
- POS

Current navigation currently exposes Products and POS according to role permissions.

The application is still in the foundation stage and is not yet a complete POS product.

---

## Phase Roadmap

### Phase 1 - Foundation

Status: COMPLETED

Includes:

- project setup
- authentication
- Supabase integration
- core database schema
- organizations
- users
- roles
- RLS foundation
- onboarding
- basic application shell
- Products foundation
- POS foundation

---

### Phase 2 - Products and Inventory

Status: NEXT

Planned features:

- product CRUD
- categories
- product search
- SKU management
- barcode support
- product pricing
- product cost
- product images
- inventory page
- stock levels
- low-stock alerts
- opening stock
- inventory adjustments
- stock count
- inventory history
- inventory transaction ledger
- role-based inventory permissions
- audit logging
- secure database operations
- inventory RLS
- appropriate database indexes
- tests

Do NOT implement Phase 3 features unless explicitly requested.

---

### Phase 3 - POS and Sales

Planned:

- product search in POS
- barcode scanning
- cart
- quantities
- discounts
- tax
- payment methods
- cash sales
- credit sales
- receipts
- sale history
- refunds
- voids
- server-side complete_sale transaction
- customer balance updates

---

### Phase 4 - Customers, Suppliers and Purchases

Planned:

- customer management
- supplier management
- purchase orders
- goods receiving
- supplier balances
- customer balances
- purchase history

---

### Phase 5 - Reports and Expenses

Planned:

- sales reports
- inventory reports
- profit reports
- expense management
- daily summaries
- monthly summaries
- cashier reports
- stock valuation
- financial dashboards

---

### Phase 6 - Security, Testing and Production

Planned:

- complete RLS review
- security review
- database transaction testing
- authorization testing
- frontend testing
- performance testing
- error handling
- audit review
- backup/recovery planning
- production configuration
- Vercel deployment
- Supabase production configuration
- monitoring

---

## Development Rules

Before modifying the application:

1. Inspect the existing repository.
2. Understand existing architecture.
3. Reuse existing components and patterns.
4. Do not rebuild the application from scratch.
5. Do not replace working functionality unnecessarily.
6. Do not introduce fake data.
7. Do not use localStorage for core business data.
8. Do not hardcode business statistics.
9. Do not bypass RLS.
10. Do not expose service_role credentials.
11. Do not make destructive database changes without explicit approval.
12. Use database migrations for schema changes.
13. Keep each phase focused.
14. Do not implement later-phase features prematurely.
15. Run tests/build checks after significant changes.

---

## Git Rules

Main branch:

`main`

Do not force push.

Do not reset published commits unless explicitly requested.

Before major changes:

```bash
git status
git log --oneline -5
