import type { QueryClient, QueryKey } from '@tanstack/react-query'

// Query-key convention (enforced by queryScope.test.ts): every query key is [root, orgId, ...].
// Roots are classified here so a context switch can invalidate/remove exactly the right entries.
// ('dashboard-totals' holds organization-wide sales/purchases sums keyed by date range —
// branch-independent by design, so a branch switch neither removes nor refetches it.)
export const ORG_ONLY_ROOTS = ['categories', 'products', 'inv-products', 'org-policy', 'org-settings', 'customers', 'sale', 'suppliers', 'purchases', 'purchase', 'dashboard-totals', 'expense-categories', 'branches', 'users'] as const
// Stock/history that also belong to ONE branch: the branch id sits at this key index.
// ('pos-stock' is POS's private per-branch stock view — registered here so a branch switch drops it too.)
export const BRANCH_KEYED_ROOTS: Record<string, number> = { branch_inventory: 2, 'pos-stock': 2, 'inv-history': 2 }
// Not keyed by the active branch, but their content depends on branch stock/sales, so refetch on branch change.
// ('expenses' + the 'report-*' roots are Phase 5 financial reads: branch-aware like 'sales',
//  so a branch switch refetches them rather than showing the previous branch's numbers.)
export const BRANCH_DEPENDENT_ROOTS = ['sales', 'pos-search', 'expenses', 'report-sales', 'report-cogs', 'report-purchases', 'report-expenses', 'report-valuation'] as const
export const ALL_ROOTS: string[] = [...ORG_ONLY_ROOTS, ...Object.keys(BRANCH_KEYED_ROOTS), ...BRANCH_DEPENDENT_ROOTS]

export type QueryContext = { userId: string | null; orgId: string | null; branchId: string | null }
const root = (k: QueryKey) => String(k[0])

// Keeps the TanStack cache consistent with the active user/organization/branch. This is a
// consistency layer only: RLS and the RPCs remain the security boundary.
export function applyContextChange(qc: QueryClient, prev: QueryContext, next: QueryContext) {
  // A different person (or signing out): nothing cached may survive.
  if (prev.userId !== next.userId) { void qc.cancelQueries(); qc.clear(); return }

  const orgChanged = prev.orgId !== next.orgId
  const branchChanged = prev.branchId !== next.branchId

  // Leaving an organization: drop everything cached for it (targeted, other orgs' entries are untouched).
  if (orgChanged && prev.orgId) {
    const leaving = (q: { queryKey: QueryKey }) => q.queryKey[1] === prev.orgId
    void qc.cancelQueries({ predicate: leaving })
    qc.removeQueries({ predicate: leaving })
  }
  // Leaving a branch within the same organization: drop that branch's stock/history entries.
  if (!orgChanged && branchChanged && prev.branchId && next.orgId) {
    qc.removeQueries({ predicate: (q) => q.queryKey[1] === next.orgId && BRANCH_KEYED_ROOTS[root(q.queryKey)] !== undefined && q.queryKey[BRANCH_KEYED_ROOTS[root(q.queryKey)]] === prev.branchId })
  }
  if (!next.orgId) return
  // Whatever remains for the now-active context is refetched (in-flight fetches are kept, not restarted).
  if (orgChanged) void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === next.orgId }, { cancelRefetch: false })
  else if (branchChanged) {
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === next.orgId && (BRANCH_KEYED_ROOTS[root(q.queryKey)] !== undefined || (BRANCH_DEPENDENT_ROOTS as readonly string[]).includes(root(q.queryKey))) }, { cancelRefetch: false })
  }
}
