import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { errorDetail } from '../lib/errors'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
import { bucketByRange, summarizeRange, type SalePoint } from '../lib/dashboard'
import { cogsTotal, incomeStatement, sumMoney } from '../lib/finance'
import { fetchCogsForSales, fetchExpensesInRange } from '../lib/financials'
import { RANGES, isCustomValid, resolveRange, type CustomRange, type RangeId } from '../lib/dateRange'
import { Card, EmptyState, Notice, Spinner, StatusBadge, pageCanvasCls, selectCls } from '../components/ui'

type Point = SalePoint & { id: string; status: string }
type PurchasePoint = { created_at: string; total: number | string; status: string }
type RecentRow = { id: string; receipt_no: string; created_at: string; status: string; total: number; balance_due: number; branch_id: string; customers: { name: string } | null }
type Product = { id: string; sku: string; name: string }
type StockRow = { product_id: string; stock_qty: number; min_stock: number }

// Same payment-status language as Sales.tsx (display only; the database is authoritative).
const payStatus = (status: string, due: number) => (status === 'void' ? 'Void' : due > 0 ? 'Credit (owing)' : 'Paid')
const payTone = (status: string, due: number): 'red' | 'amber' | 'green' =>
  (status === 'void' ? 'red' : due > 0 ? 'amber' : 'green')

// Amounts move in cents and are rounded in the DB, but the client parses numeric
// columns as floats — sum in minor units so 0.1 + 0.2 style rows cannot drift by a pesewa.
const sumTotals = (rows: { total: number | string }[]) =>
  Math.round(rows.reduce((s, r) => s + Math.round(Number(r.total) * 100), 0)) / 100

function Kpi({ label, hint, accent, children }: { label: string; hint?: string; accent: string; children: ReactNode }) {
  return (
    <Card className="relative overflow-hidden p-4">
      <span aria-hidden className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`} />
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  )
}

function KpiValue({ value }: { value: string }) {
  return <p className="text-2xl font-extrabold tracking-tight text-ink-900">{value}</p>
}

function QueryProblem({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  return (
    <div className="py-1">
      <p className="text-sm text-red-700">Could not load {what}.</p>
      <p className="mt-0.5 font-mono text-xs text-red-600">{errorDetail(error)}</p>
      <button className="mt-1 text-sm font-medium text-brand-700 hover:underline" onClick={onRetry}>Retry</button>
    </div>
  )
}

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Dashboard() {
  const { session, org, branch, branches, subscription, entitled } = useAuth()
  const [rangeId, setRangeId] = useState<RangeId>('week')
  const [custom, setCustom] = useState<CustomRange>({ startDate: '', endDate: '' })
  const money = (n: number) => `${org!.currency} ${n.toFixed(2)}`

  // Display-only: prefer the sign-up full name, fall back to the account email (same as AppShell).
  const meta = session?.user.user_metadata as { full_name?: unknown } | undefined
  const displayName =
    (typeof meta?.full_name === 'string' && meta.full_name.trim()) || session?.user.email || 'Account'
  const firstName = displayName.split(' ')[0]

  const showSales = allowed('salesHistory', org?.role)
  const showPurchases = allowed('purchases', org?.role)
  const showReports = allowed('reports', org?.role)
  const showTotals = showSales || showPurchases
  const scopeKey = branch?.id ?? 'all'

  const range = useMemo(() => resolveRange(rangeId, custom), [rangeId, custom])
  const customReady = rangeId !== 'custom' || isCustomValid(custom)
  const rangeKey = range.key

  // Organization-wide totals for the selected range (no branch filter on purpose —
  // these must cover every branch of the org). RLS still limits rows to branches
  // this user may see, and org isolation is enforced by the org_id predicate.
  // Completed = every non-void status (`complete_sale()` only writes 'completed';
  // 'partial_refund'/'refunded' remain for a future phase). Void rows are fetched
  // too so the total stays correct even if a sale is voided after the fetch.
  // staleTime: 0 so returning from Sales/Purchases after a void/receive always refetches.
  const salesRange = useQuery({ queryKey: ['dashboard-totals', org!.id, 'sales', rangeKey], enabled: showSales && customReady, staleTime: 0,
    queryFn: async () => {
      // Paged: a busy org can hold more rows in a range than one response carries.
      const rows: Point[] = []
      const PAGE = 1000
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from('sales')
          .select('id,created_at,total,status')
          .eq('org_id', org!.id)
          .gte('created_at', range.start.toISOString())
          .lt('created_at', range.end.toISOString())
          .order('created_at', { ascending: true })
          .range(offset, offset + PAGE - 1)
        if (error) throw error
        rows.push(...((data ?? []) as Point[]))
        if ((data ?? []).length < PAGE) break
      }
      return rows
    },
  })
  // Received purchases only: drafts are plans, cancelled are dead — neither is spend.
  const purchasesRange = useQuery({ queryKey: ['dashboard-totals', org!.id, 'purchases', rangeKey], enabled: showPurchases && customReady, staleTime: 0,
    queryFn: async () => {
      // Paged: a busy org can hold more rows in a range than one response carries.
      const rows: PurchasePoint[] = []
      const PAGE = 1000
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from('purchases')
          .select('created_at,total,status')
          .eq('org_id', org!.id)
          .eq('status', 'received')
          .gte('created_at', range.start.toISOString())
          .lt('created_at', range.end.toISOString())
          .order('created_at', { ascending: true })
          .range(offset, offset + PAGE - 1)
        if (error) throw error
        rows.push(...((data ?? []) as PurchasePoint[]))
        if ((data ?? []).length < PAGE) break
      }
      return rows
    },
  })

  // Phase 5 profit strip: expenses for the same range (by expense_date) plus COGS
  // from the historical sale_items snapshots of this range's completed sales.
  // Display-only — revenue/purchases logic above is untouched.
  const expensesRange = useQuery({ queryKey: ['report-expenses', org!.id, rangeKey, 'all'], enabled: showReports && customReady, staleTime: 0,
    queryFn: () => fetchExpensesInRange(supabase, org!.id, range),
  })
  const cogsRange = useQuery({ queryKey: ['report-cogs', org!.id, rangeKey, 'all'], enabled: showReports && customReady && !!salesRange.data, staleTime: 0,
    queryFn: () => fetchCogsForSales(supabase, (salesRange.data ?? []).filter((s) => s.status !== 'void').map((s) => s.id)),
  })

  const salesSummary = useMemo(
    () => summarizeRange(salesRange.data ?? [], range.start, range.end),
    [salesRange.data, range],
  )
  const purchaseTotal = useMemo(() => sumTotals(purchasesRange.data ?? []), [purchasesRange.data])
  const profitStrip = useMemo(() => {
    const revenue = salesSummary.revenue
    const cogs = cogsTotal(cogsRange.data ?? [])
    const expenses = sumMoney(expensesRange.data ?? [], (r) => (r as { amount: number | string }).amount)
    return incomeStatement({ revenue, cogs, expenses })
  }, [salesSummary.revenue, cogsRange.data, expensesRange.data])
  // A disabled (role-gated) metric counts as ready so it never blocks the other
  // metric on loading. On a preset switch the new range key has no cached data,
  // so a spinner shows instead of stale totals masquerading as the new range;
  // a background refetch of the SAME range keeps its numbers dimmed with an
  // "Updating" indicator.
  const shownSales = !showSales ? salesSummary : salesRange.data !== undefined ? salesSummary : null
  const shownPurchases = !showPurchases ? purchaseTotal : purchasesRange.data !== undefined ? purchaseTotal : null
  const salesPending = showSales && customReady && (salesRange.isLoading || salesRange.isFetching)
  const purchasesPending = showPurchases && customReady && (purchasesRange.isLoading || purchasesRange.isFetching)
  const profitPending = showReports && customReady && (expensesRange.isLoading || expensesRange.isFetching || cogsRange.isLoading || cogsRange.isFetching)
  const totalsPending = salesPending || purchasesPending || profitPending
  // COGS depends on the sales rows: a role without sales visibility counts COGS as ready.
  const profitReady = !showReports || (expensesRange.data !== undefined && (!showSales || cogsRange.data !== undefined))

  const buckets = useMemo(
    () => bucketByRange(salesRange.data ?? [], range.start, range.end),
    [salesRange.data, range],
  )
  const maxBucket = Math.max(0, ...buckets.map((b) => b.total))

  const recent = useQuery({ queryKey: ['sales', org!.id, scopeKey, 'dashboard-recent'], enabled: showSales, queryFn: async () => {
    let s = supabase.from('sales').select('id,receipt_no,created_at,status,total,balance_due,branch_id,customers(name)').eq('org_id', org!.id)
    if (branch) s = s.eq('branch_id', branch.id)
    const { data, error } = await s.order('created_at', { ascending: false }).limit(5)
    if (error) throw error
    return (data ?? []) as unknown as RecentRow[]
  } })
  // Distinct from Inventory.tsx's ['inv-products', ...] key: that query selects an
  // extra is_active column, so sharing one cache entry would leak a row-shape
  // mismatch between the pages.
  const products = useQuery({ queryKey: ['products', org!.id, 'dashboard-list'], queryFn: async () => {
    const { data, error } = await supabase.from('products').select('id,sku,name').eq('org_id', org!.id).eq('is_active', true).order('name')
    if (error) throw error
    return (data ?? []) as Product[]
  } })
  const stock = useQuery({ queryKey: ['branch_inventory', org!.id, branch?.id], enabled: !!branch, queryFn: async () => {
    const { data, error } = await supabase.from('branch_inventory').select('product_id,stock_qty,min_stock').eq('org_id', org!.id).eq('branch_id', branch!.id)
    if (error) throw error
    return (data ?? []) as StockRow[]
  } })

  const combined = useMemo(() => {
    const byProduct = new Map((stock.data ?? []).map((s) => [s.product_id, s]))
    return (products.data ?? []).map((p) => {
      const s = byProduct.get(p.id)
      return { ...p, stock_qty: Number(s?.stock_qty ?? 0), min_stock: Number(s?.min_stock ?? 0) }
    })
  }, [products.data, stock.data])
  const lowCount = combined.filter((p) => p.stock_qty > 0 && p.stock_qty <= p.min_stock).length
  const outCount = combined.filter((p) => p.stock_qty <= 0).length
  const attention = useMemo(
    () => [...combined.filter((p) => p.stock_qty <= 0), ...combined.filter((p) => p.stock_qty > 0 && p.stock_qty <= p.min_stock)].slice(0, 5),
    [combined],
  )

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '—'
  const subText = !subscription
    ? 'No subscription record'
    : subscription.status === 'trialing'
      ? `Trial${subscription.trialEndsAt ? ` ends ${new Date(subscription.trialEndsAt).toLocaleDateString()}` : ''}`
      : subscription.status.replace('_', ' ')

  const quickActions = [
    allowed('pos', org?.role) && { to: '/pos', title: 'New Sale', desc: entitled ? 'Open the POS terminal' : 'POS disabled until subscription is renewed', enabled: entitled },
    allowed('products', org?.role) && { to: '/products', title: 'Products', desc: 'Browse and manage the catalogue', enabled: true },
    allowed('inventory', org?.role) && { to: '/inventory', title: 'Inventory', desc: 'Stock levels and adjustments', enabled: true },
    allowed('salesHistory', org?.role) && { to: '/sales', title: 'Sales', desc: 'History, reprints and voids', enabled: true },
    allowed('customers', org?.role) && { to: '/customers', title: 'Customers', desc: 'Directory and credit balances', enabled: true },
    allowed('suppliers', org?.role) && { to: '/suppliers', title: 'Suppliers', desc: 'Supplier directory and contacts', enabled: true },
    allowed('purchases', org?.role) && { to: '/purchases', title: 'Purchases', desc: 'Orders, receiving and history', enabled: true },
    allowed('expenses', org?.role) && { to: '/expenses', title: 'Expenses', desc: 'Spending by branch and category', enabled: true },
    allowed('reports', org?.role) && { to: '/reports', title: 'Reports', desc: 'Sales, purchases, expenses and profit', enabled: true },
  ].filter((a): a is { to: string; title: string; desc: string; enabled: boolean } => !!a)

  const setPreset = (id: RangeId) => {
    setRangeId(id)
    if (id === 'custom' && !custom.startDate && !custom.endDate) {
      const t = todayStr()
      setCustom({ startDate: t, endDate: t })
    }
  }

  return (
    // Shared sea-blue canvas (pageCanvasCls); white/light cards on top. Queries/logic unchanged.
    <div className={pageCanvasCls}>
      {/* Welcome / business context */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">Welcome back, {firstName}</h1>
          <p className="mt-0.5 text-sm text-sky-100/85">
            Here&apos;s what&apos;s happening at {org!.name}{branch ? ` · ${branch.name}` : ''} today.
          </p>
        </div>
        {quickActions.find((a) => a.to === '/pos')?.enabled && (
          <Link
            to="/pos"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-4 py-2 text-sm font-medium text-white shadow-[0_6px_16px_-8px_rgba(28,109,217,0.7)] transition-colors hover:from-brand-600 hover:to-brand-700 focus-visible:outline-2"
          >
            New Sale
          </Link>
        )}
      </div>

      {/* Quick actions (only destinations the role may already visit) */}
      {quickActions.length > 0 && (
        <nav aria-label="Quick actions" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4 sm:gap-3">
          {quickActions.map((a) =>
            a.enabled ? (
              <Link
                key={a.to}
                to={a.to}
                className="group rounded-xl border border-brand-100 bg-white p-4 shadow-[0_1px_2px_rgba(11,37,69,0.05),0_8px_24px_-12px_rgba(28,109,217,0.18)] transition-colors hover:border-brand-300 hover:bg-brand-50/50"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-ink-900">{a.title}</span>
                  <span aria-hidden className="text-brand-500 transition-transform group-hover:translate-x-0.5">→</span>
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{a.desc}</span>
              </Link>
            ) : (
              <div
                key={a.to}
                aria-disabled="true"
                title={a.desc}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 opacity-70"
              >
                <span className="text-sm font-bold text-slate-500">{a.title}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{a.desc}</span>
              </div>
            ),
          )}
        </nav>
      )}

      {/* Sales & purchases totals — organization-wide, date-filtered */}
      {showTotals && (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <h2 className="text-base font-bold tracking-tight text-ink-900">Sales &amp; Purchases</h2>
            <div role="group" aria-label="Totals period" className="flex flex-wrap gap-1 self-start rounded-lg bg-brand-50 p-1 sm:self-auto">
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
          {rangeId === 'custom' && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="min-w-0 text-xs font-medium text-slate-600">
                Start date
                <input
                  type="date"
                  value={custom.startDate}
                  max={custom.endDate || todayStr()}
                  onChange={(e) => setCustom((c) => ({ ...c, startDate: e.target.value }))}
                  aria-label="Custom range start date"
                  className={`${selectCls} ml-2 w-auto max-w-full`}
                />
              </label>
              <label className="min-w-0 text-xs font-medium text-slate-600">
                End date
                <input
                  type="date"
                  value={custom.endDate}
                  min={custom.startDate || undefined}
                  max={todayStr()}
                  onChange={(e) => setCustom((c) => ({ ...c, endDate: e.target.value }))}
                  aria-label="Custom range end date"
                  className={`${selectCls} ml-2 w-auto max-w-full`}
                />
              </label>
              {rangeId === 'custom' && !customReady && (
                <p className="text-xs text-slate-500">Pick a start and end date (start on or before end).</p>
              )}
            </div>
          )}
          <div className="mt-3" aria-live="polite">
            {rangeId === 'custom' && !customReady ? (
              <EmptyState title="Choose a date range." hint="Pick a start and end date to see organization-wide totals." />
            ) : (showSales && salesRange.isError) || (showPurchases && purchasesRange.isError) || (showReports && (expensesRange.isError || cogsRange.isError)) ? (
              <QueryProblem
                error={salesRange.error ?? purchasesRange.error ?? expensesRange.error ?? cogsRange.error}
                onRetry={() => { void salesRange.refetch(); void purchasesRange.refetch(); void expensesRange.refetch(); void cogsRange.refetch() }}
                what="the sales, purchase and profit totals"
              />
            ) : shownSales === null || shownPurchases === null || !profitReady ? (
              <p className="py-4 text-center"><Spinner label="Loading totals…" /></p>
            ) : (
              <div className={totalsPending ? 'opacity-60 transition-opacity' : undefined}>
                <div className={showReports ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5' : 'grid grid-cols-1 gap-3 sm:grid-cols-2'}>
                  {showSales && shownSales && (
                    <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                      {totalsPending && <p className="mb-1"><Spinner label="Updating totals…" /></p>}
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Sales · {range.label}</p>
                      <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink-900">{money(shownSales.revenue)}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {shownSales.count === 0
                          ? 'No completed sales in this period.'
                          : `${shownSales.count} completed sale${shownSales.count === 1 ? '' : 's'} · avg ${money(shownSales.avg)}`}
                      </p>
                    </div>
                  )}
                  {showPurchases && shownPurchases !== null && (
                    <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                      {totalsPending && showSales && <p className="mb-1" aria-hidden="true">&nbsp;</p>}
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Purchases · {range.label}</p>
                      <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink-900">{money(shownPurchases)}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {(purchasesRange.data?.length ?? 0) === 0
                          ? 'No received purchases in this period.'
                          : `${purchasesRange.data!.length} received purchase${purchasesRange.data!.length === 1 ? '' : 's'} (organization-wide)`}
                      </p>
                    </div>
                  )}
                  {showReports && profitReady && (
                    <>
                      <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                        {totalsPending && (showSales || showPurchases) && <p className="mb-1" aria-hidden="true">&nbsp;</p>}
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Expenses · {range.label}</p>
                        <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink-900">{money(profitStrip.expenses)}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {(expensesRange.data?.length ?? 0) === 0
                            ? 'No recorded expenses in this period.'
                            : `${expensesRange.data!.length} expense${expensesRange.data!.length === 1 ? '' : 's'} (organization-wide)`}
                        </p>
                      </div>
                      <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                        {totalsPending && (showSales || showPurchases) && <p className="mb-1" aria-hidden="true">&nbsp;</p>}
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gross Profit · {range.label}</p>
                        <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink-900">{money(profitStrip.gross)}</p>
                        <p className="mt-0.5 text-xs text-slate-500">Revenue minus COGS (historical cost).</p>
                      </div>
                      <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                        {totalsPending && (showSales || showPurchases) && <p className="mb-1" aria-hidden="true">&nbsp;</p>}
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Net Profit · {range.label}</p>
                        <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink-900">{money(profitStrip.net)}</p>
                        <p className="mt-0.5 text-xs text-slate-500">Gross profit minus expenses.</p>
                      </div>
                    </>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-500">Organization-wide · all branches.</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* KPI cards — every value comes from the queries above, never hard-coded */}
      <section aria-label="Business summary" className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
        <Kpi label="Products" hint="Active products in the catalogue" accent="from-emerald-500 to-emerald-300">
          {products.isLoading ? <Spinner label="Loading products…" /> : products.isError ? <QueryProblem error={products.error} onRetry={() => products.refetch()} what="products" /> : <KpiValue value={String(products.data?.length ?? 0)} />}
        </Kpi>
        <Kpi label="Low Stock" hint={outCount ? `${outCount} out of stock` : 'Everything above minimum'} accent="from-amber-500 to-amber-300">
          {products.isLoading || stock.isLoading ? <Spinner label="Loading stock…" /> : (products.isError || stock.isError) ? (
            <QueryProblem error={products.error ?? stock.error} onRetry={() => { void products.refetch(); void stock.refetch() }} what="stock levels" />
          ) : !branch ? (
            <p className="text-sm text-slate-500">No branch available.</p>
          ) : (
            <KpiValue value={String(lowCount + outCount)} />
          )}
        </Kpi>
      </section>

      {/* Main workspace */}
      <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-2">
          {showSales && (
            <Card className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold tracking-tight text-ink-900">Sales overview</h2>
                <p className="text-xs text-slate-500">Same {range.label.toLowerCase()} range · all branches</p>
              </div>
              {rangeId === 'custom' && !customReady ? (
                <EmptyState title="Choose a date range." hint="Pick a start and end date to see the sales chart." />
              ) : salesRange.isError ? (
                <div className="py-4"><QueryProblem error={salesRange.error} onRetry={() => salesRange.refetch()} what="the sales overview" /></div>
              ) : salesRange.data === undefined ? (
                <p className="py-8 text-center"><Spinner label="Loading sales…" /></p>
              ) : salesSummary.count === 0 ? (
                <EmptyState title="No sales in this period." hint="Completed sales at any branch will appear here." />
              ) : (
                <>
                  <p className="mt-2 text-sm text-slate-600" aria-live="polite">
                    <strong className="text-lg font-extrabold tracking-tight text-ink-900">{money(salesSummary.revenue)}</strong>{' '}
                    · {salesSummary.count} order{salesSummary.count === 1 ? '' : 's'} · avg {money(salesSummary.avg)}
                  </p>
                  {/* Pure CSS bars from real daily totals — no chart dependency. */}
                  <div
                    className="mt-3 flex h-28 items-end gap-1"
                    role="img"
                    aria-label={`Daily sales for ${range.label}: ${money(salesSummary.revenue)} across ${salesSummary.count} orders`}
                  >
                    {buckets.map((b, i) => (
                      <div key={b.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1 self-stretch" title={`${b.label}: ${money(b.total)} (${b.total_count} orders)`}>
                        <div
                          className="w-full max-w-8 rounded-t bg-gradient-to-t from-brand-600 to-brand-300"
                          style={{ height: `${maxBucket > 0 ? Math.max(b.total > 0 ? 6 : 1, (b.total / maxBucket) * 100) : 1}%` }}
                        />
                        <span className="min-h-[14px] text-[10px] leading-[14px] text-slate-500">
                          {buckets.length > 7 ? (i % Math.ceil(buckets.length / 7) === 0 ? b.label : '') : b.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}

          {showSales && (
            <Card className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-bold tracking-tight text-ink-900">Recent sales</h2>
                <Link to="/sales" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>
              </div>
              <div className="mt-2 min-w-0">
                {recent.isLoading ? (
                  <p className="py-6 text-center"><Spinner label="Loading recent sales…" /></p>
                ) : recent.isError ? (
                  <QueryProblem error={recent.error} onRetry={() => recent.refetch()} what="recent sales" />
                ) : (recent.data?.length ?? 0) === 0 ? (
                  <EmptyState title="No sales yet." hint="Completed sales at this branch will appear here." />
                ) : (
                  <ul className="divide-y divide-brand-100/70">
                    {recent.data!.map((r) => (
                      <li key={r.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-xs text-slate-500">{r.receipt_no}</p>
                          <p className="truncate text-sm font-medium text-slate-800">{r.customers?.name ?? 'Walk-in'} · {branchName(r.branch_id)}</p>
                          <p className="break-words text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="whitespace-nowrap text-sm font-bold text-ink-900">{money(Number(r.total))}</span>
                          <StatusBadge tone={payTone(r.status, Number(r.balance_due))}>{payStatus(r.status, Number(r.balance_due))}</StatusBadge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-4 sm:space-y-5">
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold tracking-tight text-ink-900">Low stock</h2>
              <Link to="/inventory" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>
            </div>
            <div className="mt-2">
              {(products.isLoading || stock.isLoading) ? (
                <p className="py-6 text-center"><Spinner label="Loading stock…" /></p>
              ) : (products.isError || stock.isError) ? (
                <QueryProblem error={products.error ?? stock.error} onRetry={() => { void products.refetch(); void stock.refetch() }} what="low stock" />
              ) : !branch ? (
                <Notice tone="warn">No branch available. Ask an owner to give you branch access.</Notice>
              ) : attention.length === 0 ? (
                <EmptyState title="Stock levels look healthy." hint="Products at or below their minimum will appear here." />
              ) : (
                <ul className="divide-y divide-brand-100/70">
                  {attention.map((p) => {
                    const out = p.stock_qty <= 0
                    return (
                      <li key={p.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                          <p className="font-mono text-xs text-slate-500">{p.sku}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`whitespace-nowrap text-sm font-bold ${out ? 'text-red-700' : 'text-amber-700'}`}>
                            {p.stock_qty} / min {p.min_stock}
                          </span>
                          <StatusBadge tone={out ? 'red' : 'amber'}>{out ? 'Out' : 'Low'}</StatusBadge>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="text-base font-bold tracking-tight text-ink-900">At a glance</h2>
            <dl className="mt-2 space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-slate-500">Business</dt>
                <dd className="min-w-0 truncate font-semibold text-ink-900" title={org!.name}>{org!.name}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-slate-500">Branch</dt>
                <dd className="min-w-0 truncate font-semibold text-ink-900">{branch?.name ?? '—'}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-slate-500">Catalogue</dt>
                <dd className="font-semibold text-ink-900">{products.data?.length ?? '—'} products</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-slate-500">Out of stock</dt>
                <dd className="font-semibold text-ink-900">{branch ? outCount : '—'}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-slate-500">Subscription</dt>
                <dd className="min-w-0 truncate font-semibold capitalize text-ink-900" title={subText}>{subText}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}
