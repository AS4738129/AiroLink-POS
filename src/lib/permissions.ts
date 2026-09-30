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
  adjustInventory: ['super_admin', 'owner', 'manager', 'inventory_officer'],
} as Record<string, Role[]>
export const allowed = (feature: string, role?: Role) => !!role && !!access[feature]?.includes(role)
