import { describe, expect, it } from 'vitest'
import { addDays, dayStart, isCustomValid, resolveRange, startOfMonth, startOfWeekMonday } from './dateRange'

// Fixed "now": Wednesday 2026-09-30, noon local.
const NOW = new Date(2026, 8, 30, 12, 0, 0, 0)

describe('resolveRange', () => {
  it('today covers the current calendar day half-open', () => {
    const r = resolveRange('today', { startDate: '', endDate: '' }, NOW)
    expect(r.start).toEqual(dayStart(NOW))
    expect(r.end).toEqual(addDays(dayStart(NOW), 1))
  })
  it('yesterday covers the previous calendar day', () => {
    const r = resolveRange('yesterday', { startDate: '', endDate: '' }, NOW)
    expect(r.start).toEqual(addDays(dayStart(NOW), -1))
    expect(r.end).toEqual(dayStart(NOW))
  })
  it('this week starts on Monday (2026-09-28 for Wed 2026-09-30)', () => {
    const r = resolveRange('week', { startDate: '', endDate: '' }, NOW)
    expect(r.start).toEqual(new Date(2026, 8, 28))
    expect(r.end).toEqual(new Date(2026, 9, 5))
    // A Sunday still belongs to the Monday-start week.
    expect(startOfWeekMonday(new Date(2026, 9, 4))).toEqual(new Date(2026, 8, 28))
  })
  it('this month and last month follow calendar months', () => {
    const m = resolveRange('month', { startDate: '', endDate: '' }, NOW)
    expect(m.start).toEqual(new Date(2026, 8, 1))
    expect(m.end).toEqual(new Date(2026, 9, 1))
    expect(startOfMonth(NOW)).toEqual(new Date(2026, 8, 1))
    const l = resolveRange('lastMonth', { startDate: '', endDate: '' }, NOW)
    expect(l.start).toEqual(new Date(2026, 7, 1))
    expect(l.end).toEqual(new Date(2026, 8, 1))
  })
  it('a custom range is inclusive of both selected dates (end is start of the next day)', () => {
    const r = resolveRange('custom', { startDate: '2026-09-01', endDate: '2026-09-03' }, NOW)
    expect(r.start).toEqual(new Date(2026, 8, 1))
    expect(r.end).toEqual(new Date(2026, 8, 4))
  })
  it('an inverted or incomplete custom range resolves to a zero-width range that matches nothing', () => {
    const inv = resolveRange('custom', { startDate: '2026-09-05', endDate: '2026-09-01' }, NOW)
    expect(inv.end.getTime()).toBeLessThanOrEqual(inv.start.getTime())
    const empty = resolveRange('custom', { startDate: '', endDate: '' }, NOW)
    expect(empty.end.getTime()).toBe(empty.start.getTime())
  })
  it('every range produces a distinct cache key', () => {
    const keys = new Set(
      (['today', 'yesterday', 'week', 'month', 'lastMonth'] as const).map(
        (id) => resolveRange(id, { startDate: '', endDate: '' }, NOW).key,
      ),
    )
    expect(keys.size).toBe(5)
  })
})

describe('isCustomValid', () => {
  it('requires both dates with start on or before end', () => {
    expect(isCustomValid({ startDate: '', endDate: '' })).toBe(false)
    expect(isCustomValid({ startDate: '2026-09-01', endDate: '' })).toBe(false)
    expect(isCustomValid({ startDate: '2026-09-03', endDate: '2026-09-01' })).toBe(false)
    expect(isCustomValid({ startDate: '2026-09-01', endDate: '2026-09-01' })).toBe(true)
    expect(isCustomValid({ startDate: '2026-09-01', endDate: '2026-09-03' })).toBe(true)
  })
})
