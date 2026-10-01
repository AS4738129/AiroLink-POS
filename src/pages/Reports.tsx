import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { errorDetail } from '../lib/errors'
import { useAuth } from '../features/auth/AuthProvider'
import { cogsTotal, expenseByCategory, incomeStatement, inventoryValuation, sumMoney } from '../lib/finance'
import { fetchCogsForSales, fetchExpensesInRange, fetchPurchasesInRange, fetchSalesInRange, fetchValuation } from '../lib/financials'
import { RANGES, isCustomValid, resolveRange, type CustomRange, type RangeId } from '../lib/dateRange'
import { bucketByRange, summarizeRange } from '../lib/dashboard'
import {
  Btn, Card, CrudIcon, EmptyState, Notice, PageHeaderOnDark, Spinner,
  TableShell, selectCls, thCls, tdCls, rowCls, pageCanvasCls, StatusBadge,
} from '../components/ui'
import { methodLabel } from '../lib/payments'
import {
  buildReportCsv, buildReportXlsx, downloadCsvFile, downloadXlsxFile, printReportPdf,
  type ExpenseExportRow, type InventoryExportRow, type PurchaseExportRow, type SalesExportRow,
} from '../lib/reportExport'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-base font-bold tracking-tight text-ink-900">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </Card>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

export default function Reports() {
  const { org, branches } = useAuth()
  const [rangeId, setRangeId] = useState<RangeId>('month')
  const [custom, setCustom] = useState<CustomRange>({ startDate: '', endDate: '' })
  const [branchId, setBranchId] = useState('')
  const [exporting, setExporting] = useState<null | 'pdf' | 'excel' | 'csv'>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const money = (n: number) => `${org!.currency} ${n.toFixed(2)}`
  useEffect(() => { setRangeId('month'); setCustom({ startDate: '', endDate: '' }); setBranchId('') }, [org!.id])

  const range = useMemo(() => resolveRange(rangeId, custom), [rangeId, custom])
  const customReady = rangeId !== 'custom' || isCustomValid(custom)
  const rangeKey = range.key
  const branchKey = branchId || 'all'

  // Organization-wide by default; the branch filter only narrows further.
  // RLS still limits rows to branches this user may see.
  const sales = useQuery({ queryKey: ['report-sales', org!.id, rangeKey, branchKey], enabled: customReady, staleTime: 0,
    queryFn: () => fetchSalesInRange(supabase, org!.id, range, branchId || undefined),
  })
  const cogsItems = useQuery({ queryKey: ['report-cogs', org!.id, rangeKey, branchKey], enabled: customReady && !!sales.data, staleTime: 0,
    queryFn: () => fetchCogsForSales(supabase, (sales.data ?? []).filter((s) => s.status !== 'void').map((s) => s.id)),
  })
  const purchases = useQuery({ queryKey: ['report-purchases', org!.id, rangeKey, branchKey], enabled: customReady, staleTime: 0,
    queryFn: () => fetchPurchasesInRange(supabase, org!.id, range, branchId || undefined),
  })
  const expenses = useQuery({ queryKey: ['report-expenses', org!.id, rangeKey, branchKey], enabled: customReady, staleTime: 0,
    queryFn: () => fetchExpensesInRange(supabase, org!.id, range, branchId || undefined),
  })
  const valuation = useQuery({ queryKey: ['report-valuation', org!.id, branchKey],
    queryFn: () => fetchValuation(supabase, org!.id, branchId || undefined),
  })
  const cats = useQuery({ queryKey: ['expense-categories', org!.id], queryFn: async () => {
      const { data, error } = await supabase.from('expense_categories').select('id,name').eq('org_id', org!.id)
      if (error) throw error
      return (data ?? []) as { id: string; name: string }[]
    },
  })
  const suppliers = useQuery({
    queryKey: ['suppliers', org!.id, 'report-spend'], queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('id,name').eq('org_id', org!.id).limit(500)
      if (error) throw error
      return (data ?? []) as { id: string; name: string }[]
    },
  })

  const salesPoints = useMemo(
    () => (sales.data ?? []).map((s) => ({ created_at: s.created_at, total: s.total, status: s.status })),
    [sales.data],
  )
  const summary = useMemo(() => summarizeRange(salesPoints, range.start, range.end), [salesPoints, range])
  const buckets = useMemo(() => bucketByRange(salesPoints, range.start, range.end), [salesPoints, range])
  const maxBucket = Math.max(0, ...buckets.map((b) => b.total))
  const revenue = summary.revenue
  const cogs = useMemo(() => cogsTotal(cogsItems.data ?? []), [cogsItems.data])
  const purchaseTotal = useMemo(() => sumMoney(purchases.data ?? [], (r) => (r as { total: number | string }).total), [purchases.data])
  const expenseTotal = useMemo(() => sumMoney(expenses.data ?? [], (r) => (r as { amount: number | string }).amount), [expenses.data])
  const statement = useMemo(() => incomeStatement({ revenue, cogs, expenses: expenseTotal }), [revenue, cogs, expenseTotal])
  const stockValue = useMemo(() => inventoryValuation(valuation.data ?? []), [valuation.data])
  const catName = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? '—'
  const byCategory = useMemo(() => expenseByCategory(expenses.data ?? [], catName), [expenses.data, cats.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '—'
  const supplierName = (id: string) => suppliers.data?.find((s) => s.id === id)?.name ?? '—'

  // Branch comparison: revenue per branch within the same range (completed sales only).
  const revenueByBranch = useMemo(() => {
    const by = new Map<string, { revenue: number; count: number }>()
    for (const s of sales.data ?? []) {
      if (s.status === 'void') continue
      const e = by.get(s.branch_id) ?? { revenue: 0, count: 0 }
      e.revenue = Math.round((e.revenue + Number(s.total)) * 100) / 100
      e.count += 1
      by.set(s.branch_id, e)
    }
    return [...by].map(([id, e]) => ({ id, ...e })).sort((a, b) => b.revenue - a.revenue)
  }, [sales.data])

  const supplierSpend = useMemo(() => {
    const by = new Map<string, { total: number; count: number }>()
    for (const p of purchases.data ?? []) {
      const e = by.get(p.supplier_id) ?? { total: 0, count: 0 }
      e.total = Math.round((e.total + Number(p.total)) * 100) / 100
      e.count += 1
      by.set(p.supplier_id, e)
    }
    return [...by].map(([id, e]) => ({ id, ...e })).sort((a, b) => b.total - a.total)
  }, [purchases.data])

  const loading = sales.isLoading || purchases.isLoading || expenses.isLoading || valuation.isLoading
  const failed = sales.isError || purchases.isError || expenses.isError || cogsItems.isError || valuation.isError
  const failedError = sales.error ?? purchases.error ?? expenses.error ?? cogsItems.error ?? valuation.error
  const refetchAll = () => { void sales.refetch(); void cogsItems.refetch(); void purchases.refetch(); void expenses.refetch(); void valuation.refetch() }
  const empty = !loading && !failed && (sales.data ?? []).length === 0 && (purchases.data ?? []).length === 0 && (expenses.data ?? []).length === 0

  const setPreset = (id: RangeId) => {
    setRangeId(id)
    if (id === 'custom' && !custom.startDate && !custom.endDate) {
      const t = todayStr()
      setCustom({ startDate: t, endDate: t })
    }
  }

  // Exports reuse the rows + figures already on screen (current filters, current
  // branch scope). No extra queries, no recalculation, no new auth surface.
  const exportReady = customReady && !loading && !failed
  const runExport = (kind: 'pdf' | 'excel' | 'csv') => {
    if (!exportReady || exporting) return
    setExporting(kind)
    setExportError(null)
    try {
      const meta = {
        orgName: org!.name,
        currency: org!.currency,
        branchScope: branchId ? branchName(branchId) : 'Organization-wide',
        rangeLabel: range.label,
        generatedAt: new Date().toLocaleString(),
      }
      const exportSummary = {
        revenue: statement.revenue, cogs: statement.cogs, gross: statement.gross,
        expenses: statement.expenses, net: statement.net,
        purchaseTotal, stockValue,
        salesCount: summary.count, purchaseCount: purchases.data?.length ?? 0,
        expenseCount: expenses.data?.length ?? 0, stockLines: valuation.data?.length ?? 0,
      }
      const salesRows: SalesExportRow[] = (sales.data ?? []).map((s) => ({
        date: new Date(s.created_at).toLocaleString(), id: s.id,
        branch: branchName(s.branch_id), total: Number(s.total), status: s.status,
      }))
      const purchaseRows: PurchaseExportRow[] = (purchases.data ?? []).map((p) => ({
        date: new Date(p.created_at).toLocaleString(), id: p.id,
        supplier: supplierName(p.supplier_id), branch: branchName(p.branch_id),
        total: Number(p.total), status: p.status,
      }))
      const expenseRows: ExpenseExportRow[] = (expenses.data ?? []).map((e) => ({
        date: e.expense_date, description: e.description ?? '—',
        category: catName(e.category_id), branch: branchName(e.branch_id),
        method: methodLabel(e.payment_method),
        amount: Number(e.amount),
      }))
      const inventoryRows: InventoryExportRow[] = (valuation.data ?? []).map((r) => ({
        stockQty: Number(r.stock_qty), costPrice: Number(r.cost_price),
        lineValue: Math.round(Number(r.stock_qty) * Number(r.cost_price) * 100) / 100,
      }))
      if (kind === 'csv') downloadCsvFile(buildReportCsv({ meta, summary: exportSummary, sales: salesRows, purchases: purchaseRows, expenses: expenseRows, inventory: inventoryRows }))
      else if (kind === 'excel') downloadXlsxFile(buildReportXlsx({ meta, summary: exportSummary, sales: salesRows, purchases: purchaseRows, expenses: expenseRows, inventory: inventoryRows }))
      else printReportPdf({ meta, summary: exportSummary, sales: salesRows, purchases: purchaseRows, expenses: expenseRows, inventory: inventoryRows })
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed. Please try again.')
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className={pageCanvasCls}>
      <PageHeaderOnDark
        title="Reports"
        description="Sales, purchases, expenses and profit — from real persisted transactions."
        actions={
          <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="Export">
            <Btn variant="primary" disabled={!exportReady || exporting !== null} onClick={() => runExport('pdf')}>
              {exporting === 'pdf' ? <Spinner label="Preparing…" /> : <><CrudIcon name="print" /> Export PDF</>}
            </Btn>
            <Btn disabled={!exportReady || exporting !== null} onClick={() => runExport('excel')}>
              {exporting === 'excel' ? <Spinner label="Preparing…" /> : 'Export Excel'}
            </Btn>
            <Btn disabled={!exportReady || exporting !== null} onClick={() => runExport('csv')}>
              {exporting === 'csv' ? <Spinner label="Preparing…" /> : 'Export CSV'}
            </Btn>
          </div>
        }
      />
      {exportError && <Notice tone="err">{exportError}</Notice>}

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <h2 className="text-base font-bold tracking-tight text-ink-900">Period &amp; branch</h2>
          <div role="group" aria-label="Report period" className="flex flex-wrap gap-1 self-start rounded-lg bg-brand-50 p-1 sm:self-auto">
            {RANGES.map((p) => (
              <button
                key={p.id}
                aria-pressed={rangeId === p.id}
                onClick={() => setPreset(p.id)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  rangeId === p.id ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500 hover:text-brand-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          {rangeId === 'custom' && (
            <>
              <label className="min-w-0 text-xs font-medium text-slate-600">
                Start date
                <input type="date" value={custom.startDate} max={custom.endDate || todayStr()} onChange={(e) => setCustom((c) => ({ ...c, startDate: e.target.value }))} aria-label="Custom range start date" className={`${selectCls} ml-2 w-auto max-w-full`} />
              </label>
              <label className="min-w-0 text-xs font-medium text-slate-600">
                End date
                <input type="date" value={custom.endDate} min={custom.startDate || undefined} max={todayStr()} onChange={(e) => setCustom((c) => ({ ...c, endDate: e.target.value }))} aria-label="Custom range end date" className={`${selectCls} ml-2 w-auto max-w-full`} />
              </label>
            </>
          )}
          {/* Always visible: "All Branches" is org-wide (never the POS current
              branch); a selection narrows every query below to that branch. */}
          <label className="min-w-0 text-xs font-medium text-slate-600">
            Branch
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Branch filter" className={`${selectCls} ml-2 max-w-full sm:w-auto`}>
              <option value="">All Branches (organization-wide)</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          {rangeId === 'custom' && !customReady && (
            <p className="text-xs text-slate-500">Pick a start and end date (start on or before end).</p>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {branchId ? `Filtered to ${branchName(branchId)} · ` : 'Organization-wide · all branches · '}{range.label}
          {sales.data !== undefined && !sales.isError && ` · ${summary.count} completed sale${summary.count === 1 ? '' : 's'}`}
        </p>
      </Card>

      {rangeId === 'custom' && !customReady ? (
        <EmptyState title="Choose a date range." hint="Pick a start and end date to see every report below." />
      ) : loading ? (
        <p className="py-8 text-center"><Spinner label="Loading reports…" /></p>
      ) : failed ? (
        <Card className="p-4">
          <p className="text-sm text-red-700">Could not load reports.</p>
          <p className="mt-0.5 font-mono text-xs text-red-600">{errorDetail(failedError)}</p>
          <button className="mt-1 text-sm font-medium text-brand-700 hover:underline" onClick={refetchAll}>Retry</button>
        </Card>
      ) : empty ? (
        <EmptyState title="No transactions in this period." hint="Completed sales, received purchases and recorded expenses will appear here." />
      ) : (
        <div className="space-y-4 sm:space-y-5" aria-live="polite">
          <Section title="Profit & loss" hint="Revenue − COGS = Gross profit − Expenses = Net profit.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Stat label="Revenue" value={money(statement.revenue)} sub={`${summary.count} completed sale${summary.count === 1 ? '' : 's'}`} />
              <Stat label="COGS" value={money(statement.cogs)} sub="Qty sold × historical unit cost" />
              <Stat label="Gross profit" value={money(statement.gross)} sub={statement.gross < 0 ? 'Below-cost sales in this period' : 'Revenue minus COGS'} />
              <Stat label="Expenses" value={money(statement.expenses)} sub={`${expenses.data?.length ?? 0} expense${(expenses.data?.length ?? 0) === 1 ? '' : 's'}`} />
              <Stat label="Net profit" value={money(statement.net)} sub="Gross profit minus expenses" />
            </div>
          </Section>

          <Section title="Sales report" hint="Completed sales only — voids are excluded from every figure below.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="Total sales" value={money(summary.revenue)} sub={`${summary.count} transaction${summary.count === 1 ? '' : 's'}`} />
              <Stat label="Transactions" value={String(summary.count)} sub={summary.count ? `Avg ticket ${money(summary.avg)}` : 'No completed sales'} />
              <Stat label="Average sale" value={money(summary.avg)} sub="Revenue ÷ transactions" />
            </div>
            {buckets.some((b) => b.total > 0) && (
              <div className="mt-3 flex h-28 items-end gap-1" role="img" aria-label={`Sales trend for ${range.label}: ${money(summary.revenue)}`}>
                {buckets.map((b, i) => (
                  <div key={b.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1 self-stretch" title={`${b.label}: ${money(b.total)} (${b.total_count} orders)`}>
                    <div className="w-full max-w-8 rounded-t bg-gradient-to-t from-brand-600 to-brand-300" style={{ height: `${maxBucket > 0 ? Math.max(b.total > 0 ? 6 : 1, (b.total / maxBucket) * 100) : 1}%` }} />
                    <span className="min-h-[14px] text-[10px] leading-[14px] text-slate-500">{buckets.length > 7 ? (i % Math.ceil(buckets.length / 7) === 0 ? b.label : '') : b.label}</span>
                  </div>
                ))}
              </div>
            )}
            {revenueByBranch.length > 1 && (
              <TableShell label="Revenue by branch">
                <thead><tr><th className={thCls}>Branch</th><th className={thCls}>Sales</th><th className={thCls}>Revenue</th></tr></thead>
                <tbody>
                  {revenueByBranch.map((r) => (
                    <tr key={r.id} className={rowCls}>
                      <td className={tdCls}>{branchName(r.id)}</td>
                      <td className={tdCls}>{r.count}</td>
                      <td className={`${tdCls} font-bold`}>{money(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Section>

          <Section title="Purchase report" hint="Received purchases only — drafts and cancelled orders are never spend.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Stat label="Total purchases" value={money(purchaseTotal)} sub={`${purchases.data?.length ?? 0} received purchase${(purchases.data?.length ?? 0) === 1 ? '' : 's'}`} />
              <Stat
                label="Top supplier"
                value={supplierSpend.length ? supplierName(supplierSpend[0].id) : '—'}
                sub={supplierSpend.length ? `${money(supplierSpend[0].total)} across ${supplierSpend[0].count} order${supplierSpend[0].count === 1 ? '' : 's'}` : 'No received purchases'}
              />
            </div>
            {supplierSpend.length > 0 && (
              <TableShell label="Spend by supplier">
                <thead><tr><th className={thCls}>Supplier</th><th className={thCls}>Orders</th><th className={thCls}>Spend</th></tr></thead>
                <tbody>
                  {supplierSpend.slice(0, 10).map((r) => (
                    <tr key={r.id} className={rowCls}>
                      <td className={tdCls}>{supplierName(r.id)}</td>
                      <td className={tdCls}>{r.count}</td>
                      <td className={`${tdCls} font-bold`}>{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Section>

          <Section title="Expense report" hint="Recorded spending by expense date and category.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Stat label="Total expenses" value={money(expenseTotal)} sub={`${expenses.data?.length ?? 0} expense${(expenses.data?.length ?? 0) === 1 ? '' : 's'}`} />
              <Stat
                label="Top category"
                value={byCategory.length ? byCategory[0].name : '—'}
                sub={byCategory.length ? `${money(byCategory[0].total)} · ${byCategory[0].count} expense${byCategory[0].count === 1 ? '' : 's'}` : 'No expenses'}
              />
            </div>
            {byCategory.length > 0 && (
              <TableShell label="Expenses by category">
                <thead><tr><th className={thCls}>Category</th><th className={thCls}>Entries</th><th className={thCls}>Total</th></tr></thead>
                <tbody>
                  {byCategory.map((c) => (
                    <tr key={c.category_id} className={rowCls}>
                      <td className={tdCls}>{c.name}</td>
                      <td className={tdCls}>{c.count}</td>
                      <td className={`${tdCls} font-bold`}>{money(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Section>

          <Section title="Inventory valuation" hint="Present-tense snapshot: current quantity × current unit cost. COGS above is history; this is now.">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-2xl font-extrabold tracking-tight text-ink-900">{money(stockValue)}</p>
              <StatusBadge tone="blue">{branchId ? branchName(branchId) : 'Organization-wide'}</StatusBadge>
            </div>
            <p className="mt-1 text-xs text-slate-500">Valued across {(valuation.data ?? []).length} stocked product{(valuation.data ?? []).length === 1 ? '' : 's'}. Adjustments, sales and receiving update this figure — it is never edited by hand.</p>
          </Section>
        </div>
      )}
    </div>
  )
}
