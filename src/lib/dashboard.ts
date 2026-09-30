// Pure dashboard aggregations over sale rows already fetched from Supabase.
// Display-only summaries: RLS and the RPCs remain the security boundary.
export type SalePoint = { created_at: string; total: number | string; status?: string }

const isVoid = (p: SalePoint) => p.status === 'void'
export type DayBucket = { key: string; label: string; total: number; total_count: number }

const num = (v: number | string) => Number(v) || 0

export function startOfDay(now = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

export function daysAgo(n: number, now = new Date()): Date {
  const d = startOfDay(now)
  d.setDate(d.getDate() - n)
  return d
}

// Revenue / order count / average ticket for completed sales on/after `from` (voids excluded).
export function summarizeSales(points: SalePoint[], from: Date): { revenue: number; count: number; avg: number } {
  const t = from.getTime()
  let revenue = 0
  let count = 0
  for (const p of points) {
    if (!isVoid(p) && new Date(p.created_at).getTime() >= t) {
      revenue += num(p.total)
      count += 1
    }
  }
  revenue = Math.round(revenue * 100) / 100
  return { revenue, count, avg: count ? Math.round((revenue / count) * 100) / 100 : 0 }
}

// One bucket per calendar day (local time) for the last `days` days, oldest first.
// Days without sales are zero-filled; points outside the window are ignored.
export function bucketSalesByDay(points: SalePoint[], days: number, now = new Date()): DayBucket[] {
  const start = daysAgo(days - 1, now)
  const buckets = new Map<string, DayBucket>()
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const label =
      days <= 7
        ? d.toLocaleDateString(undefined, { weekday: 'short' })
        : d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })
    buckets.set(key, { key, label, total: 0, total_count: 0 })
  }
  for (const p of points) {
    if (isVoid(p)) continue
    const d = new Date(p.created_at)
    const b = buckets.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
    if (b) {
      b.total = Math.round((b.total + num(p.total)) * 100) / 100
      b.total_count += 1
    }
  }
  return [...buckets.values()]
}
