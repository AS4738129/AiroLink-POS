// UI convenience only. The database (RLS + RPC checks) is the real enforcement.
export type Role = 'super_admin' | 'owner' | 'manager' | 'cashier' | 'inventory_officer' | 'accountant'
export const access = {
  // Dashboard mirrors the union of the pages it links to: every role that may see at
  // least one destination may see the dashboard. It grants no data access by itself.
  dashboard: ['super_admin', 'owner', 'manager', 'cashier', 'inventory_officer', 'accountant'],
  pos: ['super_admin', 'owner', 'manager', 'cashier'],
  products: ['super_admin', 'owner', 'manager', 'inventory_officer', 'cashier', 'accountant'],
  editProducts: ['super_admin', 'owner', 'manager', 'inventory_officer'],
  inventory: ['super_admin', 'owner', 'manager', 'inventory_officer', 'accountant'],
  salesHistory: ['super_admin', 'owner', 'manager', 'cashier', 'accountant'],
  voidSales: ['super_admin', 'owner', 'manager'],
  customers: ['super_admin', 'owner', 'manager', 'cashier', 'accountant'],
  editCustomers: ['super_admin', 'owner', 'manager', 'cashier'],
  suppliers: ['super_admin', 'owner', 'manager', 'inventory_officer', 'accountant'],
  editSuppliers: ['super_admin', 'owner', 'manager', 'inventory_officer'],
  purchases: ['super_admin', 'owner', 'manager', 'inventory_officer', 'accountant'],
  editPurchases: ['super_admin', 'owner', 'manager', 'inventory_officer'],
  // Cost/profit visibility: never shown to cashiers or inventory officers.
  // The POS sale itself is unaffected — this only gates the margin display.
  viewMargin: ['super_admin', 'owner', 'manager', 'accountant'],
  // Phase 5 — expenses & financial reports. Cashiers and inventory officers are
  // excluded at both layers (here for UX, and by RLS for real enforcement).
  // Managers can create/edit expenses but cannot delete them (see deleteExpenses).
  expenses: ['super_admin', 'owner', 'manager', 'accountant'],
  editExpenses: ['super_admin', 'owner', 'manager', 'accountant'],
  deleteExpenses: ['super_admin', 'owner', 'accountant'],
  reports: ['super_admin', 'owner', 'manager', 'accountant'],
  adjustInventory: ['super_admin', 'owner', 'manager', 'inventory_officer'],
  // Phase 6B — Branch Management shell. Every member may view the branches they
  // can access (branch_sel/branch_visible enforces it); only owner/super_admin
  // may create, edit, activate/deactivate or change the main branch
  // (branch_ins/branch_upd enforce it). Managers may manage staff assignments
  // because the branch_members policy permits owner/manager/super_admin.
  branches: ['super_admin', 'owner', 'manager', 'cashier', 'inventory_officer', 'accountant'],
  editBranches: ['super_admin', 'owner'],
  assignBranches: ['super_admin', 'owner', 'manager'],
  // Phase 6C-1 — Users read-only roster shell. Every member may view the staff
  // of their own organization (mem_sel/prof_sel/branch_mem_sel enforce it).
  // There is no edit key: the page issues no writes (no invite, role change
  // or removal), so nothing here can widen access beyond the RLS boundary.
  users: ['super_admin', 'owner', 'manager', 'cashier', 'inventory_officer', 'accountant'],
  // Phase 5D — Data Management page shell. Every role sees the page, but each
  // dataset section inside is gated by its own view/edit key above, so a
  // cashier sees only customer/sales exports+customer import while an
  // inventory officer sees product/supplier/purchase/inventory sections, etc.
  dataManagement: ['super_admin', 'owner', 'manager', 'cashier', 'inventory_officer', 'accountant'],
  // Phase 6A — Business Settings shell. Every role may view the settings
  // (read through the org_sel policy); only owner/super_admin may edit
  // (the org_upd policy enforces it, the page gates the form too).
  settings: ['super_admin', 'owner', 'manager', 'cashier', 'inventory_officer', 'accountant'],
} as Record<string, Role[]>
export const allowed = (feature: string, role?: Role) => !!role && !!access[feature]?.includes(role)
