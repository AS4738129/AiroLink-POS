import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { errorDetail } from '../lib/errors'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
import { bucketSalesByDay, daysAgo, startOfDay, summarizeSales } from '../lib/dashboard'
import { Card, EmptyState, Notice, Spinner, StatusBadge } from '../components/ui'

type Point = { created_at: string; total: number; status: string }
type RecentRow = { id: string; receipt_no: string; created_at: string; status: string; total: number; balance_due: number; branch_id: string; customers: { name: string } | null }
type Product = { id: string; sku: string; name: string }
type StockRow = { product_id: string; stock_qty: number; min_stock: number }

// Same payment-status language as Sales.tsx (display only; the database is authoritative).
const payStatus = (status: string, due: number) => (status === 'void' ? 'Void' : due > 0 ? 'Credit (owing)' : 'Paid')
const payTone = (status: string, due: number): 'red' | 'amber' | 'green' =>
  (status === 'void' ? 'red' : due > 0 ? 'amber' : 'green')

const PERIODS = [
  { id: 'today', label: 'Today', days: 1 },
  { id: 'week', label: 'This Week', days: 7 },
  { id: 'month', label: 'This Month', days: 30 },
] as const
type PeriodId = (typeof PERIODS)[number]['id']

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

export default function Dashboard() {
  const { session, org, branch, branches, subscription, entitled } = useAuth()
  const [period, setPeriod] = useState<PeriodId>('week')
  const money = (n: number) => `${org!.currency} ${n.toFixed(2)}`

  // Display-only: prefer the sign-up full name, fall back to the account email (same as AppShell).
  const meta = session?.user.user_metadata as { full_name?: unknown } | undefined
  const displayName =
    (typeof meta?.full_name === 'string' && meta.full_name.trim()) || session?.user.email || 'Account'
  const firstName = displayName.split(' ')[0]

  const showSales = allowed('salesHistory', org?.role)
  const scopeKey = branch?.id ?? 'all'

  // Completed + voided points for the last 30 days at the current branch (voids are
  // excluded from every total by lib/dashboard). RLS already limits rows to branches
  // this user may see; the branch filter only narrows further.
  const points = useQuery({ queryKey: ['sales', org!.id, scopeKey, 'dashboard-30d'], enabled: showSales, queryFn: async () => {
    let s = supabase.from('sales').select('created_at,total,status').eq('org_id', org!.id).gte('created_at', daysAgo(30).toISOString())
    if (branch) s = s.eq('branch_id', branch.id)
    const { data, error } = await s.order('created_at', { ascending: true }).limit(1000)
    if (error) throw error
    return (data ?? []) as Point[]
  } })
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

  const today = useMemo(() => summarizeSales(points.data ?? [], startOfDay()), [points.data])
  const days = PERIODS.find((p) => p.id === period)!.days
  const periodSummary = useMemo(
    () => summarizeSales(points.data ?? [], days === 1 ? startOfDay() : daysAgo(days - 1)),
    [points.data, days],
  )
  const buckets = useMemo(() => bucketSalesByDay(points.data ?? [], days), [points.data, days])
  const maxBucket = Math.max(0, ...buckets.map((b) => b.total))

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
  ].filter((a): a is { to: string; title: string; desc: string; enabled: boolean } => !!a)

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Welcome / business context */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-ink-900 sm:text-2xl">Welcome back, {firstName}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
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

      {/* KPI cards — every value comes from the queries above, never hard-coded */}
      <section aria-label="Business summary" className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
        {showSales && (
          <>
            <Kpi label="Today's Sales" hint={`${today.count} order${today.count === 1 ? '' : 's'} today`} accent="from-brand-500 to-brand-300">
              {points.isLoading ? <Spinner label="Loading sales…" /> : points.isError ? <QueryProblem error={points.error} onRetry={() => points.refetch()} what="today's sales" /> : <KpiValue value={money(today.revenue)} />}
            </Kpi>
            <Kpi label="Today's Orders" hint={today.count ? `Average ticket ${money(today.avg)}` : 'No orders yet today'} accent="from-sky-500 to-brand-300">
              {points.isLoading ? <Spinner label="Loading orders…" /> : points.isError ? <QueryProblem error={points.error} onRetry={() => points.refetch()} what="today's orders" /> : <KpiValue value={String(today.count)} />}
            </Kpi>
          </>
        )}
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
                <div role="group" aria-label="Overview period" className="flex gap-1 rounded-lg bg-brand-50 p-1">
                  {PERIODS.map((p) => (
                    <button
                      key={p.id}
                      aria-pressed={period === p.id}
                      onClick={() => setPeriod(p.id)}
                      className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                        period === p.id ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500 hover:text-brand-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {points.isLoading ? (
                <p className="py-8 text-center"><Spinner label="Loading sales…" /></p>
              ) : points.isError ? (
                <div className="py-4"><QueryProblem error={points.error} onRetry={() => points.refetch()} what="the sales overview" /></div>
              ) : periodSummary.count === 0 ? (
                <EmptyState title="No sales in this period." hint="Completed sales at this branch will appear here." />
              ) : (
                <>
                  <p className="mt-2 text-sm text-slate-600" aria-live="polite">
                    <strong className="text-lg font-extrabold tracking-tight text-ink-900">{money(periodSummary.revenue)}</strong>{' '}
                    · {periodSummary.count} order{periodSummary.count === 1 ? '' : 's'} · avg {money(periodSummary.avg)}
                  </p>
                  {/* Pure CSS bars from real daily totals — no chart dependency. */}
                  <div
                    className="mt-3 flex h-28 items-end gap-1"
                    role="img"
                    aria-label={`Daily sales for ${PERIODS.find((p) => p.id === period)!.label}: ${money(periodSummary.revenue)} across ${periodSummary.count} orders`}
                  >
                    {buckets.map((b, i) => (
                      <div key={b.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1 self-stretch" title={`${b.label}: ${money(b.total)} (${b.total_count} orders)`}>
                        <div
                          className="w-full max-w-8 rounded-t bg-gradient-to-t from-brand-600 to-brand-300"
                          style={{ height: `${maxBucket > 0 ? Math.max(b.total > 0 ? 6 : 1, (b.total / maxBucket) * 100) : 1}%` }}
                        />
                        <span className="min-h-[14px] text-[10px] leading-[14px] text-slate-500">
                          {days > 7 ? (i % 5 === 0 ? b.label : '') : b.label}
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
              <div className="mt-2">
                {recent.isLoading ? (
                  <p className="py-6 text-center"><Spinner label="Loading recent sales…" /></p>
                ) : recent.isError ? (
                  <QueryProblem error={recent.error} onRetry={() => recent.refetch()} what="recent sales" />
                ) : (recent.data?.length ?? 0) === 0 ? (
                  <EmptyState title="No sales yet." hint="Completed sales at this branch will appear here." />
                ) : (
                  <ul className="divide-y divide-brand-100/70">
                    {recent.data!.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs text-slate-500">{r.receipt_no}</p>
                          <p className="truncate text-sm font-medium text-slate-800">{r.customers?.name ?? 'Walk-in'} · {branchName(r.branch_id)}</p>
                          <p className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</p>
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
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
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
