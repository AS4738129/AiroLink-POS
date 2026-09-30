import { describe, expect, it } from 'vitest'
import { bucketSalesByDay, daysAgo, startOfDay, summarizeSales, type SalePoint } from './dashboard'

const at = (d: Date, h = 12) => {
  const x = new Date(d)
  x.setHours(h, 0, 0, 0)
  return x.toISOString()
}

describe('summarizeSales', () => {
  it('sums completed sales in the window and derives the average ticket', () => {
    const now = new Date()
    const pts: SalePoint[] = [
      { created_at: at(now), total: 100, status: 'completed' },
      { created_at: at(now), total: 50, status: 'completed' },
      { created_at: at(daysAgo(2, now)), total: 999, status: 'completed' },
    ]
    expect(summarizeSales(pts, startOfDay(now))).toEqual({ revenue: 150, count: 2, avg: 75 })
  })
  it('excludes voided sales, so voids never inflate dashboard revenue', () => {
    const now = new Date()
    const pts: SalePoint[] = [
      { created_at: at(now), total: 100, status: 'completed' },
      { created_at: at(now), total: 1000, status: 'void' },
    ]
    expect(summarizeSales(pts, startOfDay(now))).toEqual({ revenue: 100, count: 1, avg: 100 })
  })
  it('returns zeros with no sales', () => {
    expect(summarizeSales([], startOfDay())).toEqual({ revenue: 0, count: 0, avg: 0 })
  })
})

describe('bucketSalesByDay', () => {
  it('produces one zero-filled bucket per day, oldest first, ignoring outside points', () => {
    const now = new Date()
    const pts: SalePoint[] = [
      { created_at: at(now), total: 40, status: 'completed' },
      { created_at: at(daysAgo(1, now)), total: 10, status: 'completed' },
      { created_at: at(daysAgo(1, now), 15), total: 20, status: 'completed' },
      { created_at: at(daysAgo(30, now)), total: 9999, status: 'completed' },
    ]
    const buckets = bucketSalesByDay(pts, 3, now)
    expect(buckets).toHaveLength(3)
    expect(buckets.map((b) => b.total)).toEqual([0, 30, 40])
    expect(buckets.map((b) => b.total_count)).toEqual([0, 2, 1])
  })
  it('skips voided sales', () => {
    const now = new Date()
    const buckets = bucketSalesByDay([{ created_at: at(now), total: 500, status: 'void' }], 1, now)
    expect(buckets[0]).toMatchObject({ total: 0, total_count: 0 })
  })
})
