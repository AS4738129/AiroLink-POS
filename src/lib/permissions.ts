// UI convenience only. The database (RLS + RPC checks) is the real enforcement.
export type Role = 'super_admin' | 'owner' | 'manager' | 'cashier' | 'inventory_officer' | 'accountant'
export const access = {
  pos: ['super_admin', 'owner', 'manager', 'cashier'],
  products: ['super_admin', 'owner', 'manager', 'inventory_officer', 'cashier', 'accountant'],
  editProducts: ['super_admin', 'owner', 'manager', 'inventory_officer'],
} as Record<string, Role[]>
export const allowed = (feature: string, role?: Role) => !!role && !!access[feature]?.includes(role)
