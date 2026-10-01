// Phase 5D tests: CSV parsing (commas/quotes/newlines/empty/UTF-8 BOM,
// unterminated quotes, duplicate headers), per-dataset validation
// (required/numerics/dates/categories/branches/dups/SKU/min-stock),
// permission gating, and export builders (headers.length === row.length for
// every dataset). No database: every input is a plain in-memory row, exactly
// as the pages already hold them under RLS.
import { describe, expect, it } from 'vitest'
import { buildReportCsv } from './reportExport'
import { allowed } from './permissions'
import {
  CUSTOMER_EXPORT_HEADERS, EXPENSE_EXPORT_HEADERS, INVENTORY_EXPORT_HEADERS,
  PRODUCT_EXPORT_HEADERS, PURCHASE_EXPORT_HEADERS, SALES_EXPORT_HEADERS,
  SUPPLIER_EXPORT_HEADERS,
  customerExportRows, expenseExportRows, inventoryExportRows,
  parseCsv, productExportRows, purchaseExportRows, salesExportRows,
  supplierExportRows, templateCsv,
  validateCustomers, validateExpenses, validateInventory,
  validateProducts, validateSuppliers,
} from './dataTransfer'

describe('parseCsv', () => {
  it('keeps commas inside quoted fields', () => {
    const t = parseCsv('Name,Phone\r\n"Acme, Ltd",0241\r\n')
    expect(t.records).toEqual([{ Name: 'Acme, Ltd', Phone: '0241' }])
  })
  it('unescapes doubled quotes', () => {
    const t = parseCsv('Name\r\n"Say ""hi"""\r\n')
    expect(t.records).toEqual([{ Name: 'Say "hi"' }])
  })
  it('keeps newlines inside quoted fields', () => {
    const t = parseCsv('Name,Note\r\n"Rice","line1\nline2"\r\n')
    expect(t.records).toEqual([{ Name: 'Rice', Note: 'line1\nline2' }])
  })
  it('skips blank lines and empty files cleanly', () => {
    expect(parseCsv('Name\r\n\r\nRice\r\n\r\n').records).toEqual([{ Name: 'Rice' }])
    expect(parseCsv('').records).toEqual([])
  })
  it('strips a UTF-8 BOM so Excel-saved headers still match', () => {
    const t = parseCsv('﻿Name,Phone\r\nAcme,0241\r\n')
    expect(t.headers).toEqual(['Name', 'Phone'])
    expect(t.records).toEqual([{ Name: 'Acme', Phone: '0241' }])
  })
  it('rejects an unterminated quote instead of swallowing the file', () => {
    expect(() => parseCsv('Name\r\n"Rice\r\nBeans\r\n')).toThrow(/closing quote/)
  })
  it('rejects a duplicated header', () => {
    expect(() => parseCsv('Name,Name\r\nRice,Beans\r\n')).toThrow(/twice/)
  })
})

describe('templates', () => {
  it('every import kind has headers and no auto-importable example row', () => {
    for (const kind of ['products', 'customers', 'suppliers', 'expenses', 'inventory'] as const) {
      const csv = templateCsv(kind)
      const t = parseCsv(csv)
      expect(t.headers.length).toBeGreaterThan(2)
      expect(t.records).toEqual([])
    }
  })
  it('product template keeps the optional SKU column (blank = auto-generated)', () => {
    const t = parseCsv(templateCsv('products'))
    expect(t.headers).toContain('SKU')
    expect(t.headers).toContain('Min Stock')
  })
  it('customer template has no balance column (ledger-only)', () => {
    expect(parseCsv(templateCsv('customers')).headers).not.toContain('Balance')
    expect(parseCsv(templateCsv('customers')).headers).not.toContain('Balance (read-only)')
  })
})

const prodBase = { SKU: '', Name: 'Rice', Barcode: 'BC-9', Category: 'Grains', Brand: '', Unit: 'bag', Description: '', 'Cost Price': '20', 'Selling Price': '30', 'Min Stock': '', Taxable: 'true', Active: 'true' }

describe('validateProducts', () => {
  const ctx = { categories: ['Grains'], existingBarcodes: ['BC-1'], existingSkus: ['PRD-000001'] }
  it('accepts a valid row (blank SKU = database generates one)', () => {
    const out = validateProducts([prodBase], ctx)
    expect(out.invalid).toEqual([])
    expect(out.valid).toHaveLength(1)
    expect(out.valid[0].sku).toBeNull()
  })
  it('accepts a supplied unique SKU and optional Min Stock', () => {
    const out = validateProducts([{ ...prodBase, SKU: 'PRD-000099', 'Min Stock': '5' }], ctx)
    expect(out.invalid).toEqual([])
    expect(out.valid[0].sku).toBe('PRD-000099')
    expect(out.valid[0].min_stock).toBe(5)
  })
  it('rejects missing name, negative prices, unknown category, bad min stock', () => {
    const out = validateProducts([
      { ...prodBase, Name: '', 'Cost Price': '-1', 'Selling Price': '-2' },
      { ...prodBase, Category: 'Nope' },
      { ...prodBase, 'Min Stock': '-3' },
    ], ctx)
    expect(out.invalid).toHaveLength(3)
    expect(out.invalid[0].errors.join(' ')).toMatch(/Name is required/)
    expect(out.invalid[1].errors.join(' ')).toMatch(/Unknown category/)
    expect(out.invalid[2].errors.join(' ')).toMatch(/Min Stock/)
  })
  it('flags existing barcodes and SKUs as duplicates, not errors', () => {
    const bc = validateProducts([{ ...prodBase, Barcode: 'BC-1' }], ctx)
    expect(bc.valid).toHaveLength(0)
    expect(bc.duplicates).toHaveLength(1)
    const sku = validateProducts([{ ...prodBase, Barcode: 'BC-9', SKU: 'PRD-000001' }], ctx)
    expect(sku.valid).toHaveLength(0)
    expect(sku.duplicates).toHaveLength(1)
  })
})

describe('validateCustomers', () => {
  it('accepts a valid row and rejects negative credit + bad email', () => {
    const ok = validateCustomers([{ Name: 'Ama', Phone: '024', Email: '', Address: '', 'Credit Limit': '100', Active: 'true' }], { existingKeys: [] })
    expect(ok.valid).toHaveLength(1)
    const bad = validateCustomers([
      { Name: '', Phone: '', Email: 'not-an-email', Address: '', 'Credit Limit': '-5', Active: 'maybe' },
    ], { existingKeys: [] })
    expect(bad.valid).toHaveLength(0)
    expect(bad.invalid[0].errors.join(' ')).toMatch(/Name is required/)
  })
  it('flags same name+phone as duplicate', () => {
    const out = validateCustomers([{ Name: 'Ama', Phone: '024', Email: '', Address: '', 'Credit Limit': '0', Active: '' }], { existingKeys: ['ama|024'] })
    expect(out.duplicates).toHaveLength(1)
  })
})

describe('validateSuppliers', () => {
  it('accepts a valid row and flags existing names', () => {
    const ok = validateSuppliers([{ Name: 'Acme', 'Contact Person': '', Phone: '', Email: '', Address: '', Active: '' }], { existingNames: [] })
    expect(ok.valid).toHaveLength(1)
    const dup = validateSuppliers([{ Name: 'Acme', 'Contact Person': '', Phone: '', Email: '', Address: '', Active: '' }], { existingNames: ['acme'] })
    expect(dup.duplicates).toHaveLength(1)
  })
})

describe('validateExpenses', () => {
  const ctx = { branches: [{ id: 'b1', name: 'Main' }], categories: ['Rent'] }
  const row = (over: Record<string, string> = {}) => ({
    Branch: 'Main', Category: 'Rent', Amount: '50', Description: 'Rent',
    'Payment Method': 'cash', 'Expense Date': '2026-09-02', ...over,
  })
  it('accepts a valid row', () => {
    expect(validateExpenses([row()], ctx).valid).toHaveLength(1)
  })
  it('rejects zero amount, bad method, unknown category/branch, bad date', () => {
    const out = validateExpenses([
      row({ Amount: '0' }),
      row({ 'Payment Method': 'cheque' }),
      row({ Category: 'Nope' }),
      row({ Branch: 'Nowhere' }),
      row({ 'Expense Date': '02/09/2026' }),
    ], ctx)
    expect(out.invalid).toHaveLength(5)
  })
})

describe('validateInventory', () => {
  const ctx = { branches: [{ id: 'b1', name: 'Main' }], existingSkus: ['PRD-000001'] }
  it('accepts opening/adjustment rows, rejects unknown SKU/branch/reason and zero qty', () => {
    const ok = validateInventory([{ SKU: 'PRD-000001', Branch: 'Main', Reason: 'opening', Quantity: '10', Note: '' }], ctx)
    expect(ok.valid).toHaveLength(1)
    const bad = validateInventory([
      { SKU: 'PRD-999', Branch: 'Main', Reason: 'opening', Quantity: '10', Note: '' },
      { SKU: 'PRD-000001', Branch: 'Nowhere', Reason: 'opening', Quantity: '10', Note: '' },
      { SKU: 'PRD-000001', Branch: 'Main', Reason: 'magic', Quantity: '10', Note: '' },
      { SKU: 'PRD-000001', Branch: 'Main', Reason: 'adjustment', Quantity: '0', Note: '' },
    ], ctx)
    expect(bad.invalid).toHaveLength(4)
  })
})

describe('permissions gate data management', () => {
  it('page shell is visible to every role; datasets stay gated by their own keys', () => {
    for (const r of ['super_admin', 'owner', 'manager', 'cashier', 'inventory_officer', 'accountant'] as const) {
      expect(allowed('dataManagement', r)).toBe(true)
    }
  })
  it('cashier cannot manage products/suppliers/purchases/inventory or expenses', () => {
    for (const f of ['editProducts', 'editSuppliers', 'editPurchases', 'adjustInventory', 'editExpenses']) {
      expect(allowed(f, 'cashier')).toBe(false)
    }
  })
  it('owner can manage every importable dataset', () => {
    for (const f of ['editProducts', 'editCustomers', 'editSuppliers', 'editPurchases', 'adjustInventory', 'editExpenses']) {
      expect(allowed(f, 'owner')).toBe(true)
    }
  })
  it('exports stay visible to viewers without edit rights', () => {
    expect(allowed('products', 'cashier')).toBe(true)
    expect(allowed('customers', 'accountant')).toBe(true)
    expect(allowed('inventory', 'accountant')).toBe(true)
    expect(allowed('salesHistory', 'cashier')).toBe(true)
    expect(allowed('purchases', 'accountant')).toBe(true)
  })
})

describe('sales/purchase exports reuse report mapping', () => {
  it('export rows carry the persisted business fields', () => {
    const csv = buildReportCsv({
      meta: { orgName: 'Acme', currency: 'GHS', branchScope: 'Organization-wide', rangeLabel: 'This Month', generatedAt: 'now' },
      summary: { revenue: 100, cogs: 20, gross: 80, expenses: 5, net: 75, purchaseTotal: 30, stockValue: 50, salesCount: 1, purchaseCount: 1, expenseCount: 1, stockLines: 1 },
      sales: [{ date: '2026-09-02', id: 's1', branch: 'Main', total: 100, status: 'completed' }],
      purchases: [{ date: '2026-09-03', id: 'p1', supplier: 'Acme', branch: 'Main', total: 30, status: 'received' }],
      expenses: [],
      inventory: [],
    })
    expect(csv).toContain('Sale ID')
    expect(csv).toContain('Purchase ID')
  })
})

// Export header consistency: headers.length === row.length with correct order,
// so a column can never silently shift under a value.
describe('export builders match their headers row-for-row', () => {
  it('products: SKU/Name/.../Taxable/Active', () => {
    const { headers, rows } = productExportRows(
      [{ sku: 'PRD-1', name: 'Rice', barcode: 'BC', category_id: 'c1', brand: 'B', unit: 'bag', description: 'D', cost_price: 20, selling_price: 30, taxable: true, is_active: true }],
      () => 'Grains',
    )
    expect([...headers]).toEqual([...PRODUCT_EXPORT_HEADERS])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveLength(headers.length)
    expect(rows[0]).toEqual(['PRD-1', 'Rice', 'BC', 'Grains', 'B', 'bag', 'D', '20.00', '30.00', 'true', 'true'])
  })
  it('customers: balance is a trailing read-only column, never an import field', () => {
    const { headers, rows } = customerExportRows(
      [{ name: 'Ama', phone: '024', email: '', address: '', credit_limit: 100, is_active: true, balance: 25 }],
    )
    expect([...headers]).toEqual([...CUSTOMER_EXPORT_HEADERS])
    expect(rows[0]).toHaveLength(headers.length)
    expect(rows[0]).toEqual(['Ama', '024', '', '', '100.00', 'true', '25.00'])
  })
  it('suppliers: mirrors the actual contact schema', () => {
    const { headers, rows } = supplierExportRows(
      [{ name: 'Acme', contact_person: 'Kofi', phone: '024', email: 'a@b.c', address: 'Accra', is_active: true }],
    )
    expect([...headers]).toEqual([...SUPPLIER_EXPORT_HEADERS])
    expect(rows[0]).toHaveLength(headers.length)
    expect(rows[0]).toEqual(['Acme', 'Kofi', '024', 'a@b.c', 'Accra', 'true'])
  })
  it('expenses: Date/Description/Category/Branch/Payment/Amount via lookups', () => {
    const { headers, rows } = expenseExportRows(
      [{ branch_id: 'b1', category_id: 'c1', amount: 50, description: 'Rent', payment_method: 'cash', expense_date: '2026-09-02' }],
      () => 'Main', () => 'Rent',
    )
    expect([...headers]).toEqual([...EXPENSE_EXPORT_HEADERS])
    expect(rows[0]).toHaveLength(headers.length)
    expect(rows[0]).toEqual(['Main', 'Rent', '50.00', 'Rent', 'Cash', '2026-09-02'])
  })
  it('inventory: SKU/Product/Branch/Stock/Min/Cost/Value from the existing sources', () => {
    const { headers, rows } = inventoryExportRows(
      [{ branch_id: 'b1', product_id: 'p1', stock_qty: 10, min_stock: 2 }],
      new Map([['p1', { sku: 'PRD-1', name: 'Rice', cost_price: 5 }]]),
      () => 'Main',
    )
    expect([...headers]).toEqual([...INVENTORY_EXPORT_HEADERS])
    expect(rows[0]).toHaveLength(headers.length)
    expect(rows[0]).toEqual(['PRD-1', 'Rice', 'Main', '10', '2', '5.00', '50.00'])
  })
  it('sales: persisted sale fields, export-only', () => {
    const { headers, rows } = salesExportRows(
      [{ receipt_no: 'R-1', created_at: '2026-09-02T12:00:00.000Z', branch_id: 'b1', customer_id: 'c1', subtotal: 90, tax_total: 10, total: 100, balance_due: 0, status: 'completed' }],
      () => 'Main', () => 'Ama',
    )
    expect([...headers]).toEqual([...SALES_EXPORT_HEADERS])
    expect(rows[0]).toHaveLength(headers.length)
    expect(rows[0][1]).toBe('R-1')
    expect(rows[0][7]).toBe('Paid')
  })
  it('purchases: persisted purchase fields, export-only', () => {
    const { headers, rows } = purchaseExportRows(
      [{ ref_no: 'PO-1', created_at: '2026-09-03T12:00:00.000Z', branch_id: 'b1', supplier_id: 's1', total: 30, status: 'received' }],
      () => 'Main', () => 'Acme',
    )
    expect([...headers]).toEqual([...PURCHASE_EXPORT_HEADERS])
    expect(rows[0]).toHaveLength(headers.length)
    expect(rows[0]).toEqual([expect.any(String), 'PO-1', 'Acme', 'Main', '30.00', 'received'])
  })
})
