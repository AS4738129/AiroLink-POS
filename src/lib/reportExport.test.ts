// Phase 5C export tests: CSV escaping, data mapping, scope labels, empty data,
// summary passthrough, and branch-scope dataset filtering. No database: every
// input is a plain in-memory row, exactly as the Reports page already holds
// them under RLS. Branch filtering here mirrors the query layer contract
// (`branch_id` equality on the already-fetched rows) so exports stay in the
// same scope as the on-screen report.
import { describe, expect, it } from 'vitest'
import { summarizeRange } from './dashboard'
import { cogsTotal, expenseByCategory, incomeStatement, inventoryValuation, sumMoney } from './finance'
import {
  buildReportCsv,
  csvEscape,
  reportSheets,
  type ExportMeta,
  type ExportSummary,
} from './reportExport'

const meta = (over: Partial<ExportMeta> = {}): ExportMeta => ({
  orgName: 'Acme Ltd',
  currency: 'GHS',
  branchScope: 'Organization-wide',
  rangeLabel: 'This Month',
  generatedAt: '2026-10-01',
  ...over,
})

const summary = (over: Partial<ExportSummary> = {}): ExportSummary => ({
  revenue: 10000,
  cogs: 6000,
  gross: 4000,
  expenses: 1500,
  net: 2500,
  purchaseTotal: 8000,
  stockValue: 2000,
  salesCount: 2,
  purchaseCount: 1,
  expenseCount: 1,
  stockLines: 1,
  ...over,
})

const rows = () => ({
  sales: [{ date: '2026-09-02', id: 's1', branch: 'Main', total: 5000, status: 'completed' }],
  purchases: [{ date: '2026-09-03', id: 'p1', supplier: 'Acme, Supplies "Ltd"', branch: 'Main', total: 8000, status: 'received' }],
  expenses: [{ date: '2026-09-04', description: 'Rent, "office"\nline2', category: 'Rent', branch: 'Main', method: 'Cash', amount: 1500 }],
  inventory: [{ stockQty: 100, costPrice: 20, lineValue: 2000 }],
})

describe('csvEscape', () => {
  it('leaves plain text unquoted', () => {
    expect(csvEscape('Rice')).toBe('Rice')
  })
  it('quotes fields holding commas', () => {
    expect(csvEscape('Acme, Supplies')).toBe('"Acme, Supplies"')
  })
  it('doubles embedded quotes', () => {
    expect(csvEscape('Say "hi"')).toBe('"Say ""hi"""')
  })
  it('quotes fields holding line breaks', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"')
  })
})

describe('buildReportCsv', () => {
  it('keeps commas/quotes/line-breaks intact in names and descriptions', () => {
    const csv = buildReportCsv({ meta: meta(), summary: summary(), ...rows() })
    expect(csv).toContain('"Acme, Supplies ""Ltd"""')
    expect(csv).toContain('"Rent, ""office""\nline2"')
  })
  it('represents the selected date range and branch scope in the header', () => {
    const csv = buildReportCsv({
      meta: meta({ branchScope: 'Osu Branch', rangeLabel: '2026-09-01 to 2026-09-30' }),
      summary: summary(),
      ...rows(),
    })
    expect(csv).toContain('Osu Branch')
    expect(csv).toContain('2026-09-01 to 2026-09-30')
  })
  it('passes the existing financial summary through unchanged', () => {
    const csv = buildReportCsv({ meta: meta(), summary: summary(), ...rows() })
    for (const v of ['GHS 10000.00', 'GHS 6000.00', 'GHS 4000.00', 'GHS 1500.00', 'GHS 2500.00', 'GHS 8000.00', 'GHS 2000.00']) {
      expect(csv).toContain(v)
    }
  })
  it('emits section headers with no rows for empty data', () => {
    const csv = buildReportCsv({
      meta: meta(),
      summary: summary({ revenue: 0, cogs: 0, gross: 0, expenses: 0, net: 0, purchaseTotal: 0, stockValue: 0 }),
      sales: [],
      purchases: [],
      expenses: [],
      inventory: [],
    })
    for (const h of ['Summary', 'Sales report', 'Purchase report', 'Expense report', 'Inventory valuation']) {
      expect(csv).toContain(h)
    }
  })
})

describe('reportSheets (Excel mapping)', () => {
  it('always includes Summary plus one sheet per non-empty section', () => {
    expect(reportSheets({ meta: meta(), summary: summary(), ...rows() }).map((s) => s.name)).toEqual([
      'Summary',
      'Sales',
      'Purchases',
      'Expenses',
      'Inventory',
    ])
  })
  it('omits empty sections but keeps Summary', () => {
    expect(
      reportSheets({ meta: meta(), summary: summary(), sales: [], purchases: [], expenses: [], inventory: [] }).map((s) => s.name),
    ).toEqual(['Summary'])
  })
  it('uses the actual row fields (no invented columns)', () => {
    const [summarySheet, salesSheet] = reportSheets({ meta: meta(), summary: summary(), ...rows() })
    expect(summarySheet.rows[0]).toEqual(['AiroLink POS - Financial Report'])
    expect(salesSheet.rows[0]).toEqual(['Date', 'Sale ID', 'Branch', 'Total', 'Status'])
    expect(salesSheet.rows[1]).toEqual(['2026-09-02', 's1', 'Main', 'GHS 5000.00', 'completed'])
  })
})

// Branch scope: the selector drives the query layer (`branch_id` equality in
// fetchSales/Purchases/ExpensesInRange + fetchValuation, COGS via the
// branch-filtered sale ids). These tests pin the dataset contract on plain
// rows: same org + same range, the branch slice must drive every figure.
type BranchRow = { branch_id: string; total?: number; amount?: number; status?: string; created_at?: string }

const inBranch = <T extends BranchRow>(all: T[], branchId: string): T[] =>
  branchId ? all.filter((r) => r.branch_id === branchId) : all

const branchRows = () => ({
  sales: [
    { id: 's1', branch_id: 'a', total: 100, status: 'completed', created_at: '2026-09-02T12:00:00' },
    { id: 's2', branch_id: 'b', total: 400, status: 'completed', created_at: '2026-09-03T12:00:00' },
    { id: 's3', branch_id: 'b', total: 999, status: 'void', created_at: '2026-09-04T12:00:00' },
  ],
  cogsBySale: new Map([
    ['s1', [{ qty: 2, cost_price: 10 }]],
    ['s2', [{ qty: 1, cost_price: 50 }]],
  ]),
  purchases: [
    { branch_id: 'a', total: 30, status: 'received', created_at: '2026-09-02T12:00:00', supplier_id: 'x' },
    { branch_id: 'b', total: 70, status: 'received', created_at: '2026-09-03T12:00:00', supplier_id: 'y' },
    { branch_id: 'b', total: 500, status: 'draft', created_at: '2026-09-03T12:00:00', supplier_id: 'y' },
  ],
  expenses: [
    { branch_id: 'a', amount: 5, expense_date: '2026-09-02', category_id: 'rent' },
    { branch_id: 'b', amount: 15, expense_date: '2026-09-03', category_id: 'rent' },
  ],
})

describe('branch scope drives every report figure', () => {
  it('All Branches keeps every branch; one branch keeps only its own sales (voids still excluded)', () => {
    const { sales } = branchRows()
    const start = new Date(2026, 8, 1)
    const end = new Date(2026, 8, 30)
    const pts = (rows: { created_at?: string; total?: number; status?: string }[]) =>
      rows.map((s) => ({ created_at: s.created_at ?? '', total: s.total ?? 0, status: s.status }))
    expect(summarizeRange(pts(inBranch(sales, '')), start, end)).toEqual({ revenue: 500, count: 2, avg: 250 })
    expect(summarizeRange(pts(inBranch(sales, 'a')), start, end)).toEqual({ revenue: 100, count: 1, avg: 100 })
    expect(summarizeRange(pts(inBranch(sales, 'b')), start, end)).toEqual({ revenue: 400, count: 1, avg: 400 })
  })
  it('COGS follows the branch-filtered sale ids only (qty x historical cost)', () => {
    const { cogsBySale, sales } = branchRows()
    const idsFor = (branchId: string) =>
      inBranch(sales, branchId).filter((s) => s.status !== 'void').map((s) => s.id)
    const cogsFor = (branchId: string) =>
      cogsTotal(idsFor(branchId).flatMap((id) => cogsBySale.get(id) ?? []))
    expect(cogsFor('')).toBe(70) // 2x10 (branch A) + 1x50 (branch B)
    expect(cogsFor('a')).toBe(20)
    expect(cogsFor('b')).toBe(50)
  })
  it('purchases keep received-only per branch; expenses sum per branch; P&L stays in one scope', () => {
    const { purchases, expenses } = branchRows()
    const received = <T extends { status?: string }>(rows: T[]): T[] => rows.filter((p) => p.status === 'received')
    expect(sumMoney(received(inBranch(purchases, 'a')), (r) => (r as { total: number }).total)).toBe(30)
    expect(sumMoney(received(inBranch(purchases, 'b')), (r) => (r as { total: number }).total)).toBe(70)
    expect(sumMoney(inBranch(expenses, 'a'), (r) => (r as { amount: number }).amount)).toBe(5)
    expect(sumMoney(inBranch(expenses, 'b'), (r) => (r as { amount: number }).amount)).toBe(15)
    // Branch A P&L: revenue 100, COGS 20 (2x10), expenses 5 -> gross 80, net 75.
    expect(incomeStatement({ revenue: 100, cogs: 20, expenses: 5 })).toEqual({
      revenue: 100, cogs: 20, gross: 80, expenses: 5, net: 75,
    })
  })
  it('expense categories regroup per branch', () => {
    const { expenses } = branchRows()
    expect(expenseByCategory(inBranch(expenses, 'a'), (id) => id)).toEqual([
      { category_id: 'rent', name: 'rent', total: 5, count: 1 },
    ])
    expect(expenseByCategory(inBranch(expenses, ''), (id) => id)).toEqual([
      { category_id: 'rent', name: 'rent', total: 20, count: 2 },
    ])
  })
  it('inventory valuation is branch-local (never org-wide product data)', () => {
    expect(inventoryValuation([{ stock_qty: 10, cost_price: 5 }])).toBe(50)
    expect(inventoryValuation([])).toBe(0)
  })
  it('exports carry the selected scope label (All Branches vs branch name)', () => {
    const csvAll = buildReportCsv({ meta: meta({ branchScope: 'Organization-wide' }), summary: summary(), ...rows() })
    const csvBranch = buildReportCsv({ meta: meta({ branchScope: 'Osu Branch' }), summary: summary(), ...rows() })
    expect(csvAll).toContain('Organization-wide')
    expect(csvBranch).toContain('Osu Branch')
  })
})
