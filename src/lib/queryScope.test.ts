import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { applyContextChange, ALL_ROOTS, BRANCH_KEYED_ROOTS, type QueryContext } from './queryScope'

const ctx = (userId: string | null, orgId: string | null, branchId: string | null): QueryContext => ({ userId, orgId, branchId })
const seed = (qc: QueryClient) => {
  const k: [unknown[], string][] = [
    [['products', 'A', 0], 'A-products'], [['categories', 'A'], 'A-cats'], [['branch_inventory', 'A', 'a1'], 'A-a1-stock'], [['branch_inventory', 'A', 'a2'], 'A-a2-stock'],
    [['pos-stock', 'A', 'a1'], 'A-a1-pos-stock'],
    [['inv-history', 'A', 'a1'], 'A-a1-hist'], [['sales', 'A', '', 0], 'A-sales'], [['pos-search', 'A', 'x'], 'A-pos'], [['sale', 'A', 's1'], 'A-sale'],
    [['products', 'B', 0], 'B-products'], [['branch_inventory', 'B', 'b1'], 'B-b1-stock'], [['customers', 'B'], 'B-custs'],
  ]
  k.forEach(([key, v]) => qc.setQueryData(key, v))
}
const has = (qc: QueryClient, key: unknown[]) => qc.getQueryData(key) !== undefined
const stale = (qc: QueryClient, key: unknown[]) => qc.getQueryState(key)?.isInvalidated === true

describe('organization switch (A → B)', () => {
  it('removes every cached entry of the previous organization, so none can be shown under B', () => {
    const qc = new QueryClient(); seed(qc)
    applyContextChange(qc, ctx('u', 'A', 'a1'), ctx('u', 'B', 'b1'))
    for (const key of [['products', 'A', 0], ['categories', 'A'], ['branch_inventory', 'A', 'a1'], ['branch_inventory', 'A', 'a2'], ['pos-stock', 'A', 'a1'], ['inv-history', 'A', 'a1'], ['sales', 'A', '', 0], ['pos-search', 'A', 'x'], ['sale', 'A', 's1']])
      expect(has(qc, key)).toBe(false)
  })
  it('keeps the new organization\'s entries but marks them stale so they refetch', () => {
    const qc = new QueryClient(); seed(qc)
    applyContextChange(qc, ctx('u', 'A', 'a1'), ctx('u', 'B', 'b1'))
    expect(has(qc, ['products', 'B', 0])).toBe(true); expect(stale(qc, ['products', 'B', 0])).toBe(true); expect(stale(qc, ['branch_inventory', 'B', 'b1'])).toBe(true)
  })
  it('is targeted: a third organization\'s entries are not touched', () => {
    const qc = new QueryClient(); seed(qc); qc.setQueryData(['products', 'C', 0], 'C-products')
    applyContextChange(qc, ctx('u', 'A', 'a1'), ctx('u', 'B', 'b1'))
    expect(has(qc, ['products', 'C', 0])).toBe(true); expect(stale(qc, ['products', 'C', 0])).toBe(false)
  })
})

describe('branch switch within an organization (a1 → a2)', () => {
  it('removes the previous branch\'s stock and history, keeps the org-level cache', () => {
    const qc = new QueryClient(); seed(qc)
    applyContextChange(qc, ctx('u', 'A', 'a1'), ctx('u', 'A', 'a2'))
    expect(has(qc, ['branch_inventory', 'A', 'a1'])).toBe(false); expect(has(qc, ['pos-stock', 'A', 'a1'])).toBe(false); expect(has(qc, ['inv-history', 'A', 'a1'])).toBe(false)
    expect(has(qc, ['products', 'A', 0])).toBe(true); expect(has(qc, ['categories', 'A'])).toBe(true)
  })
  it('invalidates branch-scoped stock, sales and POS availability', () => {
    const qc = new QueryClient(); seed(qc)
    applyContextChange(qc, ctx('u', 'A', 'a1'), ctx('u', 'A', 'a2'))
    expect(stale(qc, ['branch_inventory', 'A', 'a2'])).toBe(true); expect(stale(qc, ['sales', 'A', '', 0])).toBe(true); expect(stale(qc, ['pos-search', 'A', 'x'])).toBe(true)
  })
  it('preserves useful cache: organization-level data is neither removed nor invalidated', () => {
    const qc = new QueryClient(); seed(qc)
    applyContextChange(qc, ctx('u', 'A', 'a1'), ctx('u', 'A', 'a2'))
    for (const key of [['products', 'A', 0], ['categories', 'A'], ['sale', 'A', 's1']]) expect(stale(qc, key)).toBe(false)
    expect(has(qc, ['products', 'B', 0])).toBe(true); expect(stale(qc, ['products', 'B', 0])).toBe(false)
  })
})

describe('user change / sign-out', () => {
  it('clears the whole cache when a different user signs in', () => {
    const qc = new QueryClient(); seed(qc)
    applyContextChange(qc, ctx('u1', 'A', 'a1'), ctx('u2', 'A', 'a1')); expect(qc.getQueryCache().getAll()).toHaveLength(0)
  })
  it('clears the whole cache on sign-out', () => {
    const qc = new QueryClient(); seed(qc)
    applyContextChange(qc, ctx('u1', 'A', 'a1'), ctx(null, null, null)); expect(qc.getQueryCache().getAll()).toHaveLength(0)
  })
  it('does nothing when the context did not change', () => {
    const qc = new QueryClient(); seed(qc); applyContextChange(qc, ctx('u', 'A', 'a1'), ctx('u', 'A', 'a1'))
    expect(qc.getQueryCache().getAll()).toHaveLength(12); expect(stale(qc, ['branch_inventory', 'A', 'a1'])).toBe(false)
  })
})

describe('POS and Inventory no longer share one cache shape', () => {
  it('registering both shapes side by side is the regression test for the POS -> Inventory crash', () => {
    const qc = new QueryClient()
    qc.setQueryData(['pos-stock', 'A', 'a1'], new Map([['p1', 3]]))
    qc.setQueryData(['branch_inventory', 'A', 'a1'], [{ product_id: 'p1', stock_qty: 3, min_stock: 1 }])
    expect((qc.getQueryData(['pos-stock', 'A', 'a1']) as Map<string, number>).get('p1')).toBe(3)
    expect((qc.getQueryData(['branch_inventory', 'A', 'a1']) as { product_id: string }[]).map((r) => r.product_id)).toEqual(['p1'])
  })
})

describe('active queries actually refetch (even when their cache is still fresh)', () => {
  const observe = (qc: QueryClient, key: unknown[]) => { let calls = 0; const o = new QueryObserver(qc, { queryKey: key, queryFn: async () => ++calls, staleTime: 60_000 }); const un = o.subscribe(() => {}); return { calls: () => calls, un } }
  it('branch switch refetches a mounted stock query and sales list but not an org-level query', async () => {
    const qc = new QueryClient(); const stock = observe(qc, ['branch_inventory', 'A', 'a2']); const sales = observe(qc, ['sales', 'A', '', 0]); const prods = observe(qc, ['products', 'A', 0])
    await vi.waitFor(() => { expect([stock.calls(), sales.calls(), prods.calls()]).toEqual([1, 1, 1]); expect(qc.isFetching()).toBe(0) })  // first fetches fully settled
    applyContextChange(qc, ctx('u', 'A', 'a1'), ctx('u', 'A', 'a2'))
    await vi.waitFor(() => expect([stock.calls(), sales.calls()]).toEqual([2, 2]))
    await new Promise((r) => setTimeout(r, 50)); expect(prods.calls()).toBe(1)
    stock.un(); sales.un(); prods.un()
  })
  it('organization switch refetches every mounted query of the new organization', async () => {
    const qc = new QueryClient(); const a = observe(qc, ['products', 'B', 0]); const b = observe(qc, ['branch_inventory', 'B', 'b1'])
    await vi.waitFor(() => { expect([a.calls(), b.calls()]).toEqual([1, 1]); expect(qc.isFetching()).toBe(0) })
    applyContextChange(qc, ctx('u', 'A', 'a1'), ctx('u', 'B', 'b1'))
    await vi.waitFor(() => expect([a.calls(), b.calls()]).toEqual([2, 2])); a.un(); b.un()
  })
})

// Guards the convention the logic above depends on: a new query with an unclassified root, or without the
// organization (and, for branch data, branch) in its key, fails here instead of silently going stale.
describe('query key convention in the source', () => {
  const sources = import.meta.glob(['../pages/*.tsx', '../components/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const keys = Object.entries(sources).flatMap(([f, src]) => [...src.matchAll(/useQuery\(\{ queryKey: \[([^\]]*)\]/g)].map((m) => ({ f, parts: m[1].split(',').map((x) => x.trim()) })))
  it('finds the app\'s queries', () => expect(keys.length).toBeGreaterThanOrEqual(12))
  it.each(keys.map((k) => [k.f, k.parts] as const))('%s %j is [classified root, org id, …]', (_f, parts) => {
    const root = parts[0].replace(/['"]/g, '')
    expect(ALL_ROOTS).toContain(root); expect(parts[1]).toBe('org!.id')
    if (root in BRANCH_KEYED_ROOTS) expect(parts[BRANCH_KEYED_ROOTS[root]]).toMatch(/branch/)
  })
})
