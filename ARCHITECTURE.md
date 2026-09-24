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

Each business is an organization.

Example:

Organization A
- Users
- Products
- Customers
- Sales
- Inventory

Organization B
- Users
- Products
- Customers
- Sales
- Inventory

Data must never leak between organizations.

Most business tables contain:

`org_id`

RLS policies use organization membership to control access.

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
categories
products
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

Future examples:

`0002_inventory.sql`

`0003_sales.sql`

`0004_customers_suppliers.sql`

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

`create_organization()`

`complete_sale()`

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
