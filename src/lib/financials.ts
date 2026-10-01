// Phase 5 shared period-fetchers: display-only reads over persisted rows.
// The database is authoritative: revenue comes from persisted sales.total
// (non-void), purchases from purchases.total (received only), COGS from
// persisted sale_items.qty x sale_items.cost_price snapshots (historical cost —
// never the current products.cost_price), expenses from expenses.amount by
// expense_date, and valuation from branch_inventory x products.cost_price.
// RLS stays the security boundary; these helpers add no filtering of their own
// beyond the requested org/branch/date window.
import type { ResolvedRange } from './dateRange'
import type { CogsItem, ExpensePoint, MoneyRow, StockValRow } from './finance'

export type SaleRow = { id: string; created_at: string; total: number | string; status: string; branch_id: string }
export type PurchaseRow = { id: string; created_at: string; total: number | string; status: string; branch_id: string; supplier_id: string }
export type ExpenseRow = { amount: number | string; expense_date: string; category_id: string; branch_id: string; description: string | null; payment_method: string }
export type ValuationRow = StockValRow

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

const PAGE = 1000

const dayStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Completed = every non-void status (`complete_sale()` only writes 'completed';
// void rows are fetched too so a void landing after the fetch cannot inflate revenue).
export async function fetchSalesInRange(db: Db, orgId: string, range: ResolvedRange, branchId?: string): Promise<SaleRow[]> {
  const rows: SaleRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    let q = db
      .from('sales')
      .select('id,created_at,total,status,branch_id')
      .eq('org_id', orgId)
      .gte('created_at', range.start.toISOString())
      .lt('created_at', range.end.toISOString())
      .order('created_at', { ascending: true })
    if (branchId) q = q.eq('branch_id', branchId)
    const { data, error } = await q.range(offset, offset + PAGE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as SaleRow[]))
    if ((data ?? []).length < PAGE) break
  }
  return rows
}

// Historical cost snapshots for the given sales. Chunked: a busy period can hold
// more sale ids than one `.in()` carries.
export async function fetchCogsForSales(db: Db, saleIds: string[]): Promise<CogsItem[]> {
  if (saleIds.length === 0) return []
  const items: CogsItem[] = []
  const CHUNK = 200
  for (let i = 0; i < saleIds.length; i += CHUNK) {
    const { data, error } = await db
      .from('sale_items')
      .select('qty,cost_price')
      .in('sale_id', saleIds.slice(i, i + CHUNK))
    if (error) throw error
    items.push(...((data ?? []) as CogsItem[]))
  }
  return items
}

// Received purchases only: drafts are plans, cancelled are dead — neither is spend.
export async function fetchPurchasesInRange(db: Db, orgId: string, range: ResolvedRange, branchId?: string): Promise<PurchaseRow[]> {
  const rows: PurchaseRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    let q = db
      .from('purchases')
      .select('id,created_at,total,status,branch_id,supplier_id')
      .eq('org_id', orgId)
      .eq('status', 'received')
      .gte('created_at', range.start.toISOString())
      .lt('created_at', range.end.toISOString())
      .order('created_at', { ascending: true })
    if (branchId) q = q.eq('branch_id', branchId)
    const { data, error } = await q.range(offset, offset + PAGE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as PurchaseRow[]))
    if ((data ?? []).length < PAGE) break
  }
  return rows
}

// Expenses filter on expense_date (a date column): inclusive of both selected
// calendar days via the half-open [startDay, endDay) window.
export async function fetchExpensesInRange(db: Db, orgId: string, range: ResolvedRange, branchId?: string): Promise<ExpenseRow[]> {
  const rows: ExpenseRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    let q = db
      .from('expenses')
      .select('amount,expense_date,category_id,branch_id,description,payment_method')
      .eq('org_id', orgId)
      .gte('expense_date', dayStr(range.start))
      .lt('expense_date', dayStr(range.end))
      .order('expense_date', { ascending: true })
    if (branchId) q = q.eq('branch_id', branchId)
    const { data, error } = await q.range(offset, offset + PAGE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as ExpenseRow[]))
    if ((data ?? []).length < PAGE) break
  }
  return rows
}

// Present-tense snapshot: current quantity x CURRENT cost per product.
// (Valuation is now; COGS above is history. Neither helper writes anything.)
export async function fetchValuation(db: Db, orgId: string, branchId?: string): Promise<ValuationRow[]> {
  const inv: { product_id: string; stock_qty: number | string }[] = []
  for (let offset = 0; ; offset += PAGE) {
    let q = db
      .from('branch_inventory')
      .select('product_id,stock_qty')
      .eq('org_id', orgId)
    if (branchId) q = q.eq('branch_id', branchId)
    const { data, error } = await q.range(offset, offset + PAGE - 1)
    if (error) throw error
    inv.push(...((data ?? []) as { product_id: string; stock_qty: number | string }[]))
    if ((data ?? []).length < PAGE) break
  }
  if (inv.length === 0) return []
  const costs = new Map<string, number | string>()
  const ids = [...new Set(inv.map((r) => r.product_id))]
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db
      .from('products')
      .select('id,cost_price')
      .eq('org_id', orgId)
      .in('id', ids.slice(i, i + CHUNK))
    if (error) throw error
    for (const p of (data ?? []) as { id: string; cost_price: number | string }[]) costs.set(p.id, p.cost_price)
  }
  return inv.map((r) => ({ stock_qty: r.stock_qty, cost_price: costs.get(r.product_id) ?? 0 }))
}

export type { CogsItem, ExpensePoint, MoneyRow }
