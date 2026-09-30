// Dashboard date-range presets for the organization-wide sales/purchases totals.
// Pure calendar-day math in LOCAL time. Every range is half-open internally:
// start <= created_at < end, so a custom range is inclusive of both selected
// calendar dates without off-by-one errors. This mirrors the half-open
// filtering Sales.tsx already uses (`gte from 00:00`, `lt to 00:00 + 1 day`).
//
// Week convention: Monday-start calendar week. The app had no prior week
// definition (the old overview used trailing N-day windows), so Monday-start
// is documented here rather than inferred.
export type RangeId = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'custom'
// Raw 'YYYY-MM-DD' values from <input type="date">.
export type CustomRange = { startDate: string; endDate: string }
export type ResolvedRange = { start: Date; end: Date; key: string; label: string }

export const RANGES: { id: RangeId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'custom', label: 'Custom' },
]

export function dayStart(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// Monday-start week containing `now` (Mon=0 … Sun=6).
export function startOfWeekMonday(now = new Date()): Date {
  const d = dayStart(now)
  return addDays(d, -((d.getDay() + 6) % 7))
}

export function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// An incomplete or inverted custom selection resolves to a zero-width range
// (start == end), which matches nothing — it never inverts the filter and the
// UI shows GHS 0.00 with a prompt to pick valid dates.
export function resolveRange(id: RangeId, custom: CustomRange, now = new Date()): ResolvedRange {
  const today = dayStart(now)
  let start: Date = today
  let end: Date = addDays(today, 1)
  let label = 'Today'
  switch (id) {
    case 'today':
      start = today
      end = addDays(today, 1)
      label = 'Today'
      break
    case 'yesterday':
      start = addDays(today, -1)
      end = today
      label = 'Yesterday'
      break
    case 'week':
      start = startOfWeekMonday(now)
      end = addDays(start, 7)
      label = 'This Week'
      break
    case 'month':
      start = startOfMonth(now)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      label = 'This Month'
      break
    case 'lastMonth':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      end = startOfMonth(now)
      label = 'Last Month'
      break
    case 'custom': {
      label = custom.startDate && custom.endDate ? `${custom.startDate} to ${custom.endDate}` : 'Custom Range'
      if (!custom.startDate || !custom.endDate) {
        start = today
        end = today
        break
      }
      const s = new Date(`${custom.startDate}T00:00:00`)
      const e = addDays(new Date(`${custom.endDate}T00:00:00`), 1)
      if (!(e.getTime() > s.getTime())) {
        start = s
        end = s
        break
      }
      start = s
      end = e
      break
    }
  }
  return { start, end, key: `${id}:${isoDay(start)}:${isoDay(end)}`, label }
}

// True only when a custom selection has both dates and start <= end.
export function isCustomValid(custom: CustomRange): boolean {
  return !!custom.startDate && !!custom.endDate && custom.startDate <= custom.endDate
}
