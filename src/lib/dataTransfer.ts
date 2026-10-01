// Phase 5D — safe bulk data management helpers (pure, display/import-layer only).
// No database writes here, no RLS bypass, no service-role, no org-id trust:
// every importer derives org/branch from the session and validates branch names
// against the current org's branch list. Actual schema only:
//
// - products: sku is DB-generated when left blank (0006_auto_sku); a supplied
//   SKU is preserved and must be unique. Barcode is the other file-supplied
//   unique. Min Stock is optional and branch-owned: a provided value is applied
//   to the importer's current branch via a branch_inventory min_stock-only
//   upsert (stock_qty untouched); blank means "do not touch minimums".
// - customers: balance is ledger-only (guard_ledger), never imported.
// - suppliers: deactivation model, no delete; name match is the dedup key
//   (no DB unique on name — within-file + existing-name checks only).
// - expenses: amount > 0, five payment methods, expense_date, branch+category.
// - inventory: legitimate inventory_transactions only (opening/adjustment/
//   damaged/expired/count); never a direct stock_qty overwrite.
// - sales/purchases: export-only (bulk import would bypass complete_sale /
//   create_draft_purchase+receive_purchase, stock ledger, tax, credit, audit).
import { csvEscape } from './reportExport'
import { METHODS, methodLabel } from './payments'
import { r2 } from './calc'

export const PRODUCT_HEADERS = [
  'SKU', 'Name', 'Barcode', 'Category', 'Brand', 'Unit',
  'Description', 'Cost Price', 'Selling Price', 'Min Stock', 'Taxable', 'Active',
] as const

export const CUSTOMER_HEADERS = [
  'Name', 'Phone', 'Email', 'Address', 'Credit Limit', 'Active',
] as const

export const SUPPLIER_HEADERS = [
  'Name', 'Contact Person', 'Phone', 'Email', 'Address', 'Active',
] as const

export const EXPENSE_HEADERS = [
  'Branch', 'Category', 'Amount', 'Description', 'Payment Method', 'Expense Date',
] as const

export const INVENTORY_HEADERS = ['SKU', 'Branch', 'Reason', 'Quantity', 'Note'] as const

// ---------- Export headers (must match the row values 1:1, same order) ----------
// Import and export headers intentionally differ where the schema demands it:
// - products export the DB-assigned SKU (import: optional, generated when blank);
//   Min Stock is branch-owned (branch_inventory), so it is import-validated and
//   applied to the current branch, but exported from the inventory dataset.
// - customers export Balance as a READ-ONLY display column; it is never imported.

export const PRODUCT_EXPORT_HEADERS = [
  'SKU', 'Name', 'Barcode', 'Category', 'Brand', 'Unit',
  'Description', 'Cost Price', 'Selling Price', 'Taxable', 'Active',
] as const

export const CUSTOMER_EXPORT_HEADERS = [
  'Name', 'Phone', 'Email', 'Address', 'Credit Limit', 'Active', 'Balance (read-only)',
] as const

export const SUPPLIER_EXPORT_HEADERS = SUPPLIER_HEADERS

export const EXPENSE_EXPORT_HEADERS = EXPENSE_HEADERS

export const INVENTORY_EXPORT_HEADERS = [
  'SKU', 'Product', 'Branch', 'Stock Qty', 'Min Stock', 'Cost Price', 'Line Value',
] as const

export const SALES_EXPORT_HEADERS = [
  'Date', 'Sale ID', 'Branch', 'Customer', 'Subtotal', 'Tax', 'Total', 'Payment', 'Sale Status',
] as const

export const PURCHASE_EXPORT_HEADERS = [
  'Date', 'Purchase ID', 'Supplier', 'Branch', 'Total', 'Status',
] as const

export const TEMPLATE_FILES = {
  products: 'AiroLink-Products-Template.csv',
  customers: 'AiroLink-Customers-Template.csv',
  suppliers: 'AiroLink-Suppliers-Template.csv',
  expenses: 'AiroLink-Expenses-Template.csv',
  inventory: 'AiroLink-Inventory-Template.csv',
} as const

export type ImportKind = keyof typeof TEMPLATE_FILES

export const REASONS = ['opening', 'adjustment', 'damaged', 'expired', 'count'] as const
export type ImportReason = (typeof REASONS)[number]

const METHOD_VALUES: Set<string> = new Set(METHODS.map(([v]) => v))

// Strip a UTF-8 BOM so Excel-saved files parse cleanly.
export const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

// Minimal RFC-4180 parser: commas/quotes/CRLF/escaped quotes/newlines-in-quotes.
// Returns rows of cells; empty trailing line is dropped.
export function parseCsvCells(text: string): string[][] {
  const src = stripBom(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { rows.push(row); row = [] }
  while (i < src.length) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i += 1; continue
      }
      field += c; i += 1; continue
    }
    if (c === '"') { inQuotes = true; i += 1; continue }
    if (c === ',') { pushField(); i += 1; continue }
    if (c === '\r' && src[i + 1] === '\n') { pushField(); pushRow(); i += 2; continue }
    if (c === '\n' || c === '\r') { pushField(); pushRow(); i += 1; continue }
    field += c; i += 1
  }
  pushField(); pushRow()
  // An unterminated quote means the rest of the file was swallowed into one
  // field — fail loudly instead of importing garbage. The flag marks the
  // message as already user-friendly (see errText in DataManagement).
  if (inQuotes) {
    const err = new Error('AiroLink: this file has an opening quote (") with no closing quote — open it in a spreadsheet app and re-save as CSV.') as Error & { __friendly?: boolean }
    err.__friendly = true
    throw err
  }
  // Drop a single trailing empty line (common in editor-saved files).
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop()
  return rows
}

export type ParsedTable = { headers: string[]; records: Record<string, string>[] }

export function toTable(cells: string[][]): ParsedTable {
  if (cells.length === 0) return { headers: [], records: [] }
  const headers = cells[0].map((h) => h.trim())
  const seen = new Set<string>()
  for (const h of headers) {
    const k = h.toLowerCase()
    if (h && seen.has(k)) {
      const err = new Error(`AiroLink: this file has the column "${h}" twice — keep one and try again.`) as Error & { __friendly?: boolean }
      err.__friendly = true
      throw err
    }
    seen.add(k)
  }
  const records = cells.slice(1)
    // Skip fully-blank lines so stray newlines never become "rows".
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const rec: Record<string, string> = {}
      headers.forEach((h, k) => { rec[h] = (r[k] ?? '').trim() })
      return rec
    })
  return { headers, records }
}

export function parseCsv(text: string): ParsedTable {
  return toTable(parseCsvCells(text))
}

export function buildCsv(headers: readonly string[], rows: (string | number)[][]): string {
  return [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\r\n') + '\r\n'
}

export function templateCsv(kind: ImportKind): string {
  switch (kind) {
    case 'products': return buildCsv(PRODUCT_HEADERS, [])
    case 'customers': return buildCsv(CUSTOMER_HEADERS, [])
    case 'suppliers': return buildCsv(SUPPLIER_HEADERS, [])
    case 'expenses': return buildCsv(EXPENSE_HEADERS, [])
    case 'inventory': return buildCsv(INVENTORY_HEADERS, [])
  }
}

// ---------- Shared validation primitives ----------

const norm = (s: string) => s.trim().toLowerCase()
const isBlank = (s: string | undefined) => !s || s.trim() === ''

export function parseNum(raw: string): number | null {
  if (isBlank(raw)) return null
  const n = Number(raw.trim())
  return Number.isFinite(n) ? n : null
}

export function parseBool(raw: string, fallback: boolean): boolean | null {
  if (isBlank(raw)) return fallback
  const t = norm(raw)
  if (['true', 'yes', '1', 'active', 'y'].includes(t)) return true
  if (['false', 'no', '0', 'inactive', 'n'].includes(t)) return false
  return null
}

export function isValidDay(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return false
  const [y, m, d] = raw.trim().split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

export function isFutureDay(raw: string): boolean {
  const t = new Date(`${raw.trim()}T00:00:00`).getTime()
  const now = new Date(); now.setHours(0, 0, 0, 0)
  return t > now.getTime()
}

export type RowIssue = { index: number; errors: string[] }

export type Validated<T> = {
  valid: (T & { _row: number })[]
  invalid: RowIssue[]
  duplicates: RowIssue[]
  warnings: string[]
}

export type BranchOpt = { id: string; name: string }

// Branch names are human-readable in files; ids never come from a file.
export function resolveBranch(raw: string, branches: BranchOpt[]): BranchOpt | null {
  if (isBlank(raw)) return null
  return branches.find((b) => norm(b.name) === norm(raw)) ?? null
}

// ---------- Products ----------

export type ProductImport = {
  sku: string | null; name: string; barcode: string | null; category: string; brand: string | null
  unit: string; description: string | null; cost_price: number; selling_price: number
  min_stock: number | null; taxable: boolean; is_active: boolean
}

export function validateProducts(
  records: Record<string, string>[],
  ctx: { categories: string[]; existingBarcodes: string[]; existingSkus: string[] },
): Validated<ProductImport> {
  const valid: Validated<ProductImport>['valid'] = []
  const invalid: RowIssue[] = []
  const duplicates: RowIssue[] = []
  const warnings: string[] = []
  const seenBarcode = new Set<string>()
  const seenSku = new Set<string>()
  const existing = new Set(ctx.existingBarcodes.map(norm))
  const existingSku = new Set(ctx.existingSkus.map(norm))
  const catSet = new Set(ctx.categories.map(norm))

  records.forEach((r, k) => {
    const index = k + 2 // 1-based + header
    const errs: string[] = []
    const name = (r['Name'] ?? '').trim()
    if (!name) errs.push('Name is required')
    // SKU is optional: a blank SKU lets the database generate one
    // (see 0006_auto_sku); a supplied SKU is preserved and must be unique.
    const skuRaw = (r['SKU'] ?? '').trim()
    if (skuRaw.length > 64) errs.push('SKU must be 64 characters or fewer')
    const sku = skuRaw || null
    const barcode = (r['Barcode'] ?? '').trim() || null
    const category = (r['Category'] ?? '').trim()
    if (category && !catSet.has(norm(category))) errs.push(`Unknown category "${category}" — create it on the Products page first`)
    const unit = (r['Unit'] ?? '').trim() || 'pcs'
    const cost = parseNum(r['Cost Price'] ?? '')
    if (cost === null || cost < 0) errs.push('Cost Price must be 0 or more')
    const selling = parseNum(r['Selling Price'] ?? '')
    if (selling === null || selling < 0) errs.push('Selling Price must be 0 or more')
    // Min Stock is optional and branch-owned: blank means "do not touch branch
    // minimums"; a provided value must be a non-negative number.
    const minRaw = (r['Min Stock'] ?? '').trim()
    let minStock: number | null = null
    if (minRaw !== '') {
      const m = parseNum(minRaw)
      if (m === null || m < 0) errs.push('Min Stock must be 0 or more (or blank)')
      else minStock = m
    }
    const taxable = parseBool(r['Taxable'] ?? '', true)
    if (taxable === null) errs.push('Taxable must be true/false')
    const active = parseBool(r['Active'] ?? '', true)
    if (active === null) errs.push('Active must be true/false')
    if (sku) {
      const key = norm(sku)
      if (seenSku.has(key)) errs.push(`Duplicate SKU "${sku}" inside this file`)
      else if (existingSku.has(key)) {
        duplicates.push({ index, errors: [`SKU "${sku}" already exists — it will be skipped`] })
        seenSku.add(key)
        return
      }
      seenSku.add(key)
    }
    if (barcode) {
      const key = norm(barcode)
      if (seenBarcode.has(key)) errs.push(`Duplicate barcode "${barcode}" inside this file`)
      else if (existing.has(key)) {
        duplicates.push({ index, errors: [`Barcode "${barcode}" already exists — it will be skipped`] })
        seenBarcode.add(key)
        return
      }
      seenBarcode.add(key)
    }
    if (errs.length > 0) { invalid.push({ index, errors: errs }); return }
    valid.push({
      _row: index, sku, name, barcode,
      category, brand: (r['Brand'] ?? '').trim() || null,
      unit, description: (r['Description'] ?? '').trim() || null,
      cost_price: cost!, selling_price: selling!, min_stock: minStock,
      taxable: taxable!, is_active: active!,
    })
  })
  if (valid.length > 0 && ctx.categories.length === 0) warnings.push('No categories exist yet — categorized rows will be rejected until categories are created.')
  return { valid, invalid, duplicates, warnings }
}

// ---------- Customers (balance never imported) ----------

export type CustomerImport = {
  name: string; phone: string | null; email: string | null; address: string | null
  credit_limit: number; is_active: boolean
}

export function validateCustomers(
  records: Record<string, string>[],
  ctx: { existingKeys: string[] },
): Validated<CustomerImport> {
  const valid: Validated<CustomerImport>['valid'] = []
  const invalid: RowIssue[] = []
  const duplicates: RowIssue[] = []
  const warnings: string[] = []
  const existing = new Set(ctx.existingKeys.map(norm))
  const seen = new Set<string>()
  const keyOf = (name: string, phone: string) => `${norm(name)}|${norm(phone)}`

  records.forEach((r, k) => {
    const index = k + 2
    const errs: string[] = []
    const name = (r['Name'] ?? '').trim()
    if (!name) errs.push('Name is required')
    const phone = (r['Phone'] ?? '').trim() || ''
    const credit = parseNum(r['Credit Limit'] ?? '0')
    if (credit === null || credit < 0) errs.push('Credit Limit must be 0 or more')
    const active = parseBool(r['Active'] ?? '', true)
    if (active === null) errs.push('Active must be true/false')
    const email = (r['Email'] ?? '').trim()
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errs.push('Email is invalid')
    const key = keyOf(name || '', phone)
    if (!errs.length) {
      if (seen.has(key)) errs.push('Duplicate customer (same name + phone) inside this file')
      else if (existing.has(key)) {
        duplicates.push({ index, errors: ['Customer already exists (same name + phone) — it will be skipped'] })
        seen.add(key)
        return
      }
      seen.add(key)
    }
    if (errs.length > 0) { invalid.push({ index, errors: errs }); return }
    valid.push({
      _row: index, name, phone: phone || null,
      email: email || null, address: (r['Address'] ?? '').trim() || null,
      credit_limit: credit!, is_active: active!,
    })
  })
  warnings.push('Balances are never imported — every new customer starts at zero and balances move only through sales and voids.')
  return { valid, invalid, duplicates, warnings }
}

// ---------- Suppliers ----------

export type SupplierImport = {
  name: string; contact_person: string | null; phone: string | null
  email: string | null; address: string | null; is_active: boolean
}

export function validateSuppliers(
  records: Record<string, string>[],
  ctx: { existingNames: string[] },
): Validated<SupplierImport> {
  const valid: Validated<SupplierImport>['valid'] = []
  const invalid: RowIssue[] = []
  const duplicates: RowIssue[] = []
  const warnings: string[] = [] // kept for the shared Validated shape: supplier rows need no caveats
  const existing = new Set(ctx.existingNames.map(norm))
  const seen = new Set<string>()

  records.forEach((r, k) => {
    const index = k + 2
    const errs: string[] = []
    const name = (r['Name'] ?? '').trim()
    if (!name) errs.push('Name is required')
    const email = (r['Email'] ?? '').trim()
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errs.push('Email is invalid')
    const active = parseBool(r['Active'] ?? '', true)
    if (active === null) errs.push('Active must be true/false')
    const key = norm(name || '')
    if (!errs.length && key) {
      if (seen.has(key)) errs.push(`Duplicate supplier "${name}" inside this file`)
      else if (existing.has(key)) {
        duplicates.push({ index, errors: [`Supplier "${name}" already exists — it will be skipped`] })
        seen.add(key)
        return
      }
      seen.add(key)
    }
    if (errs.length > 0) { invalid.push({ index, errors: errs }); return }
    valid.push({
      _row: index, name,
      contact_person: (r['Contact Person'] ?? '').trim() || null,
      phone: (r['Phone'] ?? '').trim() || null,
      email: email || null, address: (r['Address'] ?? '').trim() || null,
      is_active: active!,
    })
  })
  return { valid, invalid, duplicates, warnings }
}

// ---------- Expenses ----------

export type ExpenseImport = {
  branch_id: string; branch_name: string; category: string
  amount: number; description: string | null; payment_method: string; expense_date: string
}

export function validateExpenses(
  records: Record<string, string>[],
  ctx: { branches: BranchOpt[]; categories: string[] },
): Validated<ExpenseImport> {
  const valid: Validated<ExpenseImport>['valid'] = []
  const invalid: RowIssue[] = []
  const duplicates: RowIssue[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  const catSet = new Set(ctx.categories.map(norm))

  records.forEach((r, k) => {
    const index = k + 2
    const errs: string[] = []
    const branch = resolveBranch(r['Branch'] ?? '', ctx.branches)
    if (!branch) errs.push(`Unknown branch "${(r['Branch'] ?? '').trim() || '(blank)'}" — use one of your business branches`)
    const category = (r['Category'] ?? '').trim()
    if (!category) errs.push('Category is required')
    else if (!catSet.has(norm(category))) errs.push(`Unknown category "${category}" — create it on the Expenses page first`)
    const amount = parseNum(r['Amount'] ?? '')
    if (amount === null || amount <= 0) errs.push('Amount must be greater than zero')
    const method = norm(r['Payment Method'] ?? 'cash') || 'cash'
    if (!METHOD_VALUES.has(method)) errs.push(`Payment Method must be one of cash/momo/card/bank/other`)
    const day = (r['Expense Date'] ?? '').trim()
    if (!isValidDay(day)) errs.push('Expense Date must be YYYY-MM-DD')
    else if (isFutureDay(day)) errs.push('Expense Date cannot be in the future')
    const desc = (r['Description'] ?? '').trim()
    const dupKey = `${norm(r['Branch'] ?? '')}|${norm(category)}|${amount}|${norm(desc)}|${day}`
    if (!errs.length) {
      if (seen.has(dupKey)) {
        duplicates.push({ index, errors: ['Duplicate of an earlier row in this file — it will be skipped'] })
        return
      }
      seen.add(dupKey)
    }
    if (errs.length > 0) { invalid.push({ index, errors: errs }); return }
    valid.push({
      _row: index, branch_id: branch!.id, branch_name: branch!.name,
      category, amount: amount!, description: desc || null,
      payment_method: method, expense_date: day,
    })
  })
  if (ctx.categories.length === 0) warnings.push('No expense categories exist yet — create them on the Expenses page before importing.')
  warnings.push('Re-uploading the same file creates duplicates — each valid row is a new expense.')
  return { valid, invalid, duplicates, warnings }
}

// ---------- Inventory (ledger transactions only) ----------

export type InventoryImport = {
  sku: string; branch_id: string; branch_name: string
  reason: ImportReason; quantity: number; note: string | null
}

export function validateInventory(
  records: Record<string, string>[],
  ctx: { branches: BranchOpt[]; existingSkus: string[] },
): Validated<InventoryImport> {
  const valid: Validated<InventoryImport>['valid'] = []
  const invalid: RowIssue[] = []
  const duplicates: RowIssue[] = []
  const warnings: string[] = []
  const skuSet = new Set(ctx.existingSkus.map(norm))
  const seen = new Set<string>()

  records.forEach((r, k) => {
    const index = k + 2
    const errs: string[] = []
    const sku = (r['SKU'] ?? '').trim()
    if (!sku) errs.push('SKU is required')
    else if (!skuSet.has(norm(sku))) errs.push(`Unknown SKU "${sku}" — add the product first`)
    const branch = resolveBranch(r['Branch'] ?? '', ctx.branches)
    if (!branch) errs.push(`Unknown branch "${(r['Branch'] ?? '').trim() || '(blank)'}"`)
    const reason = norm(r['Reason'] ?? '') as ImportReason
    if (!(REASONS as readonly string[]).includes(reason)) errs.push('Reason must be opening/adjustment/damaged/expired/count')
    const qty = parseNum(r['Quantity'] ?? '')
    if (qty === null) errs.push('Quantity must be a number')
    else if (reason === 'count' && qty < 0) errs.push('Count quantity cannot be negative (it is the counted total)')
    else if (reason !== 'count' && qty === 0) errs.push('Quantity cannot be zero for this reason')
    const key = `${norm(sku)}|${norm(r['Branch'] ?? '')}|${reason}|${qty}`
    if (!errs.length) {
      if (seen.has(key)) {
        duplicates.push({ index, errors: ['Duplicate of an earlier row in this file — it will be skipped'] })
        return
      }
      seen.add(key)
    }
    if (errs.length > 0) { invalid.push({ index, errors: errs }); return }
    valid.push({
      _row: index, sku, branch_id: branch!.id, branch_name: branch!.name,
      reason, quantity: qty!, note: (r['Note'] ?? '').trim() || null,
    })
  })
  warnings.push('Every imported row becomes an inventory ledger entry (opening/adjustment/damaged/expired/count) — history is preserved, stock is never overwritten directly.')
  return { valid, invalid, duplicates, warnings }
}

export const KIND_LABEL: Record<ImportKind, string> = {
  products: 'Products', customers: 'Customers', suppliers: 'Suppliers',
  expenses: 'Expenses', inventory: 'Inventory',
}

// ---------- Export row builders (headers.length === row.length, same order) ----------
// Pure mappers from already-fetched page rows: no queries, no RLS bypass.
// Each returns [headers, rows] so `headers.length === row.length` is structural.
// Money is formatted with r2 + toFixed(2) exactly like the pages display it.

export function productExportRows(
  rows: { sku?: unknown; name?: unknown; barcode?: unknown; category_id?: unknown; brand?: unknown; unit?: unknown; description?: unknown; cost_price?: unknown; selling_price?: unknown; taxable?: unknown; is_active?: unknown }[],
  catName: (id: string) => string,
): { headers: readonly string[]; rows: (string | number)[][] } {
  return {
    headers: PRODUCT_EXPORT_HEADERS,
    rows: rows.map((p) => [
      String(p.sku ?? ''), String(p.name ?? ''), String(p.barcode ?? ''),
      catName(String(p.category_id ?? '')) === '—' ? '' : catName(String(p.category_id ?? '')),
      String(p.brand ?? ''), String(p.unit ?? ''), String(p.description ?? ''),
      r2(Number(p.cost_price ?? 0)).toFixed(2), r2(Number(p.selling_price ?? 0)).toFixed(2),
      (p.taxable as boolean) ? 'true' : 'false', (p.is_active as boolean) ? 'true' : 'false',
    ]),
  }
}

export function customerExportRows(
  rows: { name?: unknown; phone?: unknown; email?: unknown; address?: unknown; credit_limit?: unknown; is_active?: unknown; balance?: unknown }[],
): { headers: readonly string[]; rows: (string | number)[][] } {
  return {
    headers: CUSTOMER_EXPORT_HEADERS,
    rows: rows.map((c) => [
      String(c.name ?? ''), String(c.phone ?? ''), String(c.email ?? ''),
      String(c.address ?? ''), r2(Number(c.credit_limit ?? 0)).toFixed(2),
      (c.is_active as boolean) ? 'true' : 'false',
      r2(Number(c.balance ?? 0)).toFixed(2),
    ]),
  }
}

export function supplierExportRows(
  rows: { name?: unknown; contact_person?: unknown; phone?: unknown; email?: unknown; address?: unknown; is_active?: unknown }[],
): { headers: readonly string[]; rows: (string | number)[][] } {
  return {
    headers: SUPPLIER_EXPORT_HEADERS,
    rows: rows.map((s) => [
      String(s.name ?? ''), String(s.contact_person ?? ''), String(s.phone ?? ''),
      String(s.email ?? ''), String(s.address ?? ''),
      (s.is_active as boolean) ? 'true' : 'false',
    ]),
  }
}

export function expenseExportRows(
  rows: { branch_id?: unknown; category_id?: unknown; amount?: unknown; description?: unknown; payment_method?: unknown; expense_date?: unknown }[],
  branchName: (id: string) => string,
  catName: (id: string) => string,
): { headers: readonly string[]; rows: (string | number)[][] } {
  return {
    headers: EXPENSE_EXPORT_HEADERS,
    rows: rows.map((e) => [
      branchName(String(e.branch_id ?? '')), catName(String(e.category_id ?? '')),
      r2(Number(e.amount ?? 0)).toFixed(2),
      String(e.description ?? ''), methodLabel(String(e.payment_method ?? '')),
      String(e.expense_date ?? ''),
    ]),
  }
}

export function inventoryExportRows(
  inv: { branch_id?: unknown; product_id?: unknown; stock_qty?: unknown; min_stock?: unknown }[],
  byProduct: Map<string, { sku?: unknown; name?: unknown; cost_price?: unknown }>,
  branchName: (id: string) => string,
): { headers: readonly string[]; rows: (string | number)[][] } {
  return {
    headers: INVENTORY_EXPORT_HEADERS,
    rows: inv.map((r) => {
      const p = byProduct.get(String(r.product_id ?? ''))
      const qty = Number(r.stock_qty ?? 0)
      const cost = Number(p?.cost_price ?? 0)
      return [
        String(p?.sku ?? ''), String(p?.name ?? ''), branchName(String(r.branch_id ?? '')),
        String(qty), String(r.min_stock ?? ''),
        r2(cost).toFixed(2), r2(qty * cost).toFixed(2),
      ]
    }),
  }
}

export function salesExportRows(
  sales: { receipt_no?: unknown; created_at?: unknown; branch_id?: unknown; customer_id?: unknown; subtotal?: unknown; tax_total?: unknown; total?: unknown; balance_due?: unknown; status?: unknown }[],
  branchName: (id: string) => string,
  custName: (id: string) => string,
): { headers: readonly string[]; rows: (string | number)[][] } {
  return {
    headers: SALES_EXPORT_HEADERS,
    rows: sales.map((s) => [
      new Date(String(s.created_at ?? '')).toLocaleString(), String(s.receipt_no ?? ''),
      branchName(String(s.branch_id ?? '')),
      s.customer_id ? custName(String(s.customer_id)) : 'Walk-in',
      r2(Number(s.subtotal ?? 0)).toFixed(2), r2(Number(s.tax_total ?? 0)).toFixed(2),
      r2(Number(s.total ?? 0)).toFixed(2),
      String(s.status) === 'void' ? 'Void' : Number(s.balance_due) > 0 ? 'Credit (owing)' : 'Paid',
      String(s.status ?? ''),
    ]),
  }
}

export function purchaseExportRows(
  purs: { ref_no?: unknown; created_at?: unknown; branch_id?: unknown; supplier_id?: unknown; total?: unknown; status?: unknown }[],
  branchName: (id: string) => string,
  supName: (id: string) => string,
): { headers: readonly string[]; rows: (string | number)[][] } {
  return {
    headers: PURCHASE_EXPORT_HEADERS,
    rows: purs.map((p) => [
      new Date(String(p.created_at ?? '')).toLocaleString(), String(p.ref_no ?? ''),
      supName(String(p.supplier_id ?? '')), branchName(String(p.branch_id ?? '')),
      r2(Number(p.total ?? 0)).toFixed(2), String(p.status ?? ''),
    ]),
  }
}
