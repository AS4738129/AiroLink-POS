// Phase 5D — Data Management: safe bulk import/export over the ACTUAL schema.
// Import-layer only: org/branch always come from the session, never the file;
// writes go through the same RLS-gated tables/ledger paths the pages use
// (products/customers/suppliers/expenses direct writes, inventory via
// inventory_transactions ledger, sales/purchases export-only).
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
import { downloadBlob } from '../lib/reportExport'
import {
  CUSTOMER_EXPORT_HEADERS, CUSTOMER_HEADERS, EXPENSE_EXPORT_HEADERS, EXPENSE_HEADERS,
  INVENTORY_EXPORT_HEADERS, INVENTORY_HEADERS, PRODUCT_EXPORT_HEADERS, PRODUCT_HEADERS,
  PURCHASE_EXPORT_HEADERS, SALES_EXPORT_HEADERS, SUPPLIER_EXPORT_HEADERS, SUPPLIER_HEADERS,
  TEMPLATE_FILES, buildCsv, customerExportRows, expenseExportRows, inventoryExportRows,
  parseCsv, productExportRows, purchaseExportRows, salesExportRows, supplierExportRows,
  templateCsv, validateCustomers, validateExpenses, validateInventory, validateProducts,
  validateSuppliers,
  type ExpenseImport, type ImportKind, type InventoryImport, type CustomerImport,
  type ProductImport, type RowIssue, type SupplierImport,
} from '../lib/dataTransfer'
import {
  Btn, Card, CrudIcon, Dialog, Field, Notice, PageHeaderOnDark,
  Spinner, TableShell, rowCls, selectCls, tdCls, thCls, filterBarCls, pageCanvasCls,
} from '../components/ui'

const PAGE = 1000
const MAX_ROWS = 5000
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB: enough for thousands of rows, small enough to stay responsive
type DupMode = 'skip' | 'reject'

type Preview = {
  kind: ImportKind
  fileName: string
  total: number
  valid: (ProductImport | CustomerImport | SupplierImport | ExpenseImport | InventoryImport)[]
  invalid: RowIssue[]
  duplicates: RowIssue[]
  warnings: string[]
}

type Result = { ok: boolean; text: string }

// Bump the local file cap from bytes alone: 5 MB or 5,000 rows, whichever hits first.
const fileSizeLabel = (n: number) => (n / 1024 / 1024).toFixed(1)

export default function DataManagement() {
  const { org, branch, branches } = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<null | string>(null)
  const [note, setNote] = useState<Result | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [dupMode, setDupMode] = useState<DupMode>('skip')
  const [processing, setProcessing] = useState(false)

  // View gates mirror the pages: export needs the page's view key, import needs edit.
  const canViewProducts = allowed('products', org?.role)
  const canEditProducts = allowed('editProducts', org?.role)
  const canViewCustomers = allowed('customers', org?.role)
  const canEditCustomers = allowed('editCustomers', org?.role)
  const canViewSuppliers = allowed('suppliers', org?.role)
  const canEditSuppliers = allowed('editSuppliers', org?.role)
  const canViewInventory = allowed('inventory', org?.role)
  const canAdjustInventory = allowed('adjustInventory', org?.role)
  const canViewExpenses = allowed('expenses', org?.role)
  const canEditExpenses = allowed('editExpenses', org?.role)
  const canSalesExport = allowed('salesHistory', org?.role)
  const canPurchasesView = allowed('purchases', org?.role)

  const orgId = org?.id ?? null
  useEffect(() => { setNote(null); setPreview(null); setDupMode('skip') }, [orgId])

  const download = (name: string, csv: string) =>
    downloadBlob(name, new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))

  const downloadTemplate = (kind: ImportKind) => download(TEMPLATE_FILES[kind], templateCsv(kind))

  const errText = (e: unknown) =>
    (e as { __friendly?: boolean })?.__friendly === true
      ? String((e as { message?: string }).message ?? 'Could not read this file.')
      : friendly(e)

  // ---------- Paged org-scoped readers (RLS stays the boundary) ----------

  async function pageThrough(table: string, select: string, order: string): Promise<Record<string, unknown>[]> {
    if (!orgId) throw new Error('No business selected.')
    const out: Record<string, unknown>[] = []
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase.from(table).select(select).eq('org_id', orgId).order(order).range(offset, offset + PAGE - 1)
      if (error) throw error
      out.push(...((data ?? []) as unknown as Record<string, unknown>[]))
      if ((data ?? []).length < PAGE) break
    }
    return out
  }

  const refreshAfter = (kind: ImportKind) => {
    if (kind === 'products') {
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['inv-products'] })
      void qc.invalidateQueries({ queryKey: ['pos-search'] })
    } else if (kind === 'customers') {
      void qc.invalidateQueries({ queryKey: ['customers'] })
    } else if (kind === 'suppliers') {
      void qc.invalidateQueries({ queryKey: ['suppliers'] })
    } else if (kind === 'expenses') {
      void qc.invalidateQueries({ queryKey: ['expenses'] })
      void qc.invalidateQueries({ queryKey: ['dashboard-totals'] })
      void qc.invalidateQueries({ queryKey: ['report-expenses'] })
    } else {
      // Inventory ledger writes change stock everywhere it is shown.
      void qc.invalidateQueries({ queryKey: ['branch_inventory'] })
      void qc.invalidateQueries({ queryKey: ['pos-stock'] })
      void qc.invalidateQueries({ queryKey: ['inv-history'] })
    }
  }

  // ---------- Exports (current org only, never other orgs) ----------

  const exportProducts = async () => {
    setBusy('products'); setNote(null)
    try {
      const cats = await pageThrough('categories', 'id,name', 'name')
      const catName = new Map(cats.map((c) => [String(c.id), String(c.name)]))
      const rows = await pageThrough('products', 'sku,name,barcode,category_id,brand,unit,description,cost_price,selling_price,taxable,is_active', 'name')
      const { headers, rows: data } = productExportRows(rows, (id) => catName.get(id) ?? '—')
      if (headers.length !== PRODUCT_EXPORT_HEADERS.length) throw new Error('Product export mismatch.')
      download('AiroLink-Products.csv', buildCsv(headers, data))
      setNote({ ok: true, text: `Exported ${rows.length} products.` })
    } catch (e) { setNote({ ok: false, text: friendly(e) }) } finally { setBusy(null) }
  }

  const exportCustomers = async () => {
    setBusy('customers'); setNote(null)
    try {
      const rows = await pageThrough('customers', 'name,phone,email,address,credit_limit,is_active,balance', 'name')
      const { headers, rows: data } = customerExportRows(rows)
      if (headers.length !== CUSTOMER_EXPORT_HEADERS.length) throw new Error('Customer export mismatch.')
      download('AiroLink-Customers.csv', buildCsv(headers, data))
      setNote({ ok: true, text: `Exported ${rows.length} customers. Balances are read-only — never import them.` })
    } catch (e) { setNote({ ok: false, text: friendly(e) }) } finally { setBusy(null) }
  }

  const exportSuppliers = async () => {
    setBusy('suppliers'); setNote(null)
    try {
      const rows = await pageThrough('suppliers', 'name,contact_person,phone,email,address,is_active', 'name')
      const { headers, rows: data } = supplierExportRows(rows)
      if (headers.length !== SUPPLIER_EXPORT_HEADERS.length) throw new Error('Supplier export mismatch.')
      download('AiroLink-Suppliers.csv', buildCsv(headers, data))
      setNote({ ok: true, text: `Exported ${rows.length} suppliers.` })
    } catch (e) { setNote({ ok: false, text: friendly(e) }) } finally { setBusy(null) }
  }

  const exportExpenses = async () => {
    setBusy('expenses'); setNote(null)
    try {
      const [cats, rows] = await Promise.all([
        pageThrough('expense_categories', 'id,name', 'name'),
        pageThrough('expenses', 'branch_id,category_id,amount,description,payment_method,expense_date', 'expense_date'),
      ])
      const catName = new Map(cats.map((c) => [String(c.id), String(c.name)]))
      const branchName = new Map(branches.map((b) => [b.id, b.name]))
      const { headers, rows: data } = expenseExportRows(rows, (id) => branchName.get(id) ?? '—', (id) => catName.get(id) ?? '—')
      if (headers.length !== EXPENSE_EXPORT_HEADERS.length) throw new Error('Expense export mismatch.')
      download('AiroLink-Expenses.csv', buildCsv(headers, data))
      setNote({ ok: true, text: `Exported ${rows.length} expenses.` })
    } catch (e) { setNote({ ok: false, text: friendly(e) }) } finally { setBusy(null) }
  }

  const exportInventory = async () => {
    setBusy('inventory'); setNote(null)
    try {
      const [inv, prods] = await Promise.all([
        pageThrough('branch_inventory', 'branch_id,product_id,stock_qty,min_stock', 'product_id'),
        pageThrough('products', 'id,sku,name,cost_price', 'name'),
      ])
      const byId = new Map(prods.map((p) => [String(p.id), p]))
      const branchName = new Map(branches.map((b) => [b.id, b.name]))
      const { headers, rows: data } = inventoryExportRows(inv, byId, (id) => branchName.get(id) ?? '—')
      if (headers.length !== INVENTORY_EXPORT_HEADERS.length) throw new Error('Inventory export mismatch.')
      download('AiroLink-Inventory.csv', buildCsv(headers, data))
      setNote({ ok: true, text: `Exported ${inv.length} stock lines.` })
    } catch (e) { setNote({ ok: false, text: friendly(e) }) } finally { setBusy(null) }
  }

  const exportSales = async () => {
    setBusy('sales'); setNote(null)
    try {
      const [sales, custs] = await Promise.all([
        pageThrough('sales', 'receipt_no,created_at,branch_id,customer_id,subtotal,tax_total,total,balance_due,status', 'created_at'),
        pageThrough('customers', 'id,name', 'name'),
      ])
      const custName = new Map(custs.map((c) => [String(c.id), String(c.name)]))
      const branchName = new Map(branches.map((b) => [b.id, b.name]))
      const { headers, rows: data } = salesExportRows(sales, (id) => branchName.get(id) ?? '—', (id) => custName.get(id) ?? '')
      if (headers.length !== SALES_EXPORT_HEADERS.length) throw new Error('Sales export mismatch.')
      download('AiroLink-Sales.csv', buildCsv(headers, data))
      setNote({ ok: true, text: `Exported ${sales.length} sales (export-only — sales cannot be imported).` })
    } catch (e) { setNote({ ok: false, text: friendly(e) }) } finally { setBusy(null) }
  }

  const exportPurchases = async () => {
    setBusy('purchases'); setNote(null)
    try {
      const [purs, sups] = await Promise.all([
        pageThrough('purchases', 'ref_no,created_at,branch_id,supplier_id,total,status', 'created_at'),
        pageThrough('suppliers', 'id,name', 'name'),
      ])
      const supName = new Map(sups.map((s) => [String(s.id), String(s.name)]))
      const branchName = new Map(branches.map((b) => [b.id, b.name]))
      const { headers, rows: data } = purchaseExportRows(purs, (id) => branchName.get(id) ?? '—', (id) => supName.get(id) ?? '—')
      if (headers.length !== PURCHASE_EXPORT_HEADERS.length) throw new Error('Purchase export mismatch.')
      download('AiroLink-Purchases.csv', buildCsv(headers, data))
      setNote({ ok: true, text: `Exported ${purs.length} purchases (export-only — purchases are created and received on the Purchases page).` })
    } catch (e) { setNote({ ok: false, text: friendly(e) }) } finally { setBusy(null) }
  }

  // ---------- Import: upload → parse → validate → preview ----------

  const IMPORT_HEADERS: Record<ImportKind, readonly string[]> = {
    products: PRODUCT_HEADERS, customers: CUSTOMER_HEADERS, suppliers: SUPPLIER_HEADERS,
    expenses: EXPENSE_HEADERS, inventory: INVENTORY_HEADERS,
  }

  const onFile = async (kind: ImportKind, file: File | undefined) => {
    if (!file || !orgId) return
    setNote(null); setPreview(null); setDupMode('skip')
    if (file.size > MAX_BYTES) {
      setNote({ ok: false, text: `This file is ${fileSizeLabel(file.size)} MB — keep imports under 5 MB (about ${MAX_ROWS.toLocaleString()} rows). Split it and try again.` })
      return
    }
    setBusy(`import-${kind}`)
    try {
      const text = await file.text()
      if (!text.trim()) {
        setNote({ ok: false, text: 'This file is empty. Download the template, fill in at least one row, and try again.' })
        return
      }
      const table = parseCsv(text) // throws a friendly error on stray quotes / dup headers
      const required = IMPORT_HEADERS[kind]
      const unknown = table.headers.filter((h) => h && !required.includes(h))
      if (unknown.length > 0) {
        setNote({ ok: false, text: `Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Use the ${kind} template so every column matches.` })
        return
      }
      const missing = required.filter((h) => !table.headers.includes(h))
      if (missing.length > 0) {
        setNote({ ok: false, text: `This file does not look like a ${kind} template — missing: ${missing.join(', ')}. Download the template and try again.` })
        return
      }
      if (table.records.length === 0) {
        setNote({ ok: false, text: 'No data rows found in this file. Fill in at least one row under the headers and try again.' })
        return
      }
      if (table.records.length > MAX_ROWS) {
        setNote({ ok: false, text: `This file has ${table.records.length.toLocaleString()} rows — split it into files of ${MAX_ROWS.toLocaleString()} rows or fewer.` })
        return
      }
      const norm = (s: string) => s.trim().toLowerCase()
      if (kind === 'products') {
        const [cats, prods] = await Promise.all([
          pageThrough('categories', 'id,name', 'name'),
          pageThrough('products', 'sku,barcode', 'name'),
        ])
        const out = validateProducts(table.records, {
          categories: cats.map((c) => String(c.name)),
          existingBarcodes: prods.map((p) => String(p.barcode ?? '')).filter(Boolean),
          existingSkus: prods.map((p) => String(p.sku ?? '')).filter(Boolean),
        })
        setPreview({ kind, fileName: file.name, total: table.records.length, ...out })
      } else if (kind === 'customers') {
        const custs = await pageThrough('customers', 'name,phone', 'name')
        const out = validateCustomers(table.records, {
          existingKeys: custs.map((c) => `${norm(String(c.name ?? ''))}|${norm(String(c.phone ?? ''))}`),
        })
        setPreview({ kind, fileName: file.name, total: table.records.length, ...out })
      } else if (kind === 'suppliers') {
        const sups = await pageThrough('suppliers', 'name', 'name')
        const out = validateSuppliers(table.records, { existingNames: sups.map((s) => String(s.name)) })
        setPreview({ kind, fileName: file.name, total: table.records.length, ...out })
      } else if (kind === 'expenses') {
        const cats = await pageThrough('expense_categories', 'id,name', 'name')
        const out = validateExpenses(table.records, {
          branches: branches.map((b) => ({ id: b.id, name: b.name })),
          categories: cats.map((c) => String(c.name)),
        })
        setPreview({ kind, fileName: file.name, total: table.records.length, ...out })
      } else {
        const prods = await pageThrough('products', 'id,sku', 'name')
        const out = validateInventory(table.records, {
          branches: branches.map((b) => ({ id: b.id, name: b.name })),
          existingSkus: prods.map((p) => String(p.sku)),
        })
        setPreview({ kind, fileName: file.name, total: table.records.length, ...out })
      }
    } catch (e) {
      setNote({ ok: false, text: errText(e) })
    } finally {
      setBusy(null)
    }
  }

  // ---------- Import: confirm → batched writes through existing paths ----------

  const chunked = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  }

  const confirmImport = async () => {
    if (!preview || processing || !orgId) return
    setProcessing(true); setNote(null)
    try {
      let imported = 0, skipped = 0
      const kind = preview.kind
      const norm = (s: string) => s.trim().toLowerCase()
      const rejected = preview.duplicates.length
      // Duplicates default to Skip; Reject stops the whole file before any write.
      if (dupMode === 'reject' && rejected > 0) {
        setNote({ ok: false, text: `Rejected: ${rejected} duplicate row${rejected === 1 ? ' was' : 's were'} not imported. Nothing was imported — remove the duplicate rows and upload again.` })
        return
      }

      if (kind === 'products') {
        // Products import at the CURRENT branch for min-stock: Min Stock is
        // branch-owned (branch_inventory), so a provided value updates only this
        // branch's minimum via a min_stock-only upsert (stock_qty untouched).
        if (!branch) throw new Error('Choose a branch before importing products — Min Stock applies to the current branch.')
        const cats = await pageThrough('categories', 'id,name', 'name')
        const catId = new Map(cats.map((c) => [norm(String(c.name)), String(c.id)]))
        const rows = preview.valid as ProductImport[]
        const payloads = rows.map((r) => ({
          org_id: orgId,
          // Blank SKU → null lets the database generate one (0006_auto_sku);
          // a supplied SKU is preserved (unique per org).
          sku: r.sku || null,
          name: r.name, barcode: r.barcode,
          category_id: r.category ? (catId.get(norm(r.category)) ?? null) : null,
          brand: r.brand, unit: r.unit, description: r.description,
          cost_price: r.cost_price, selling_price: r.selling_price,
          taxable: r.taxable, is_active: r.is_active,
        }))
        // Bulk product creation is header-only: ids are not returned in bulk, so
        // Min Stock matches this branch by the unique(barcode) / unique(sku) row
        // the insert just created. (Barcode-less rows have no safe match key, so
        // their Min Stock is reported, not silently dropped.)
        const minByBarcode = new Map<string, number>()
        const minBySku = new Map<string, number>()
        const minsSkipped: string[] = []
        for (const r of rows) {
          if (r.min_stock === null) continue
          if (r.barcode) minByBarcode.set(norm(r.barcode), r.min_stock)
          else if (r.sku) minBySku.set(norm(r.sku), r.min_stock)
          else minsSkipped.push(`${r.name} (no barcode or SKU to match Min Stock)`)
        }
        let minsApplied = 0
        for (const chunk of chunked(payloads, 200)) {
          const { error } = await supabase.from('products').insert(chunk)
          if (error) throw error
          imported += chunk.length
        }
        if (minByBarcode.size > 0 || minBySku.size > 0) {
          const created = await pageThrough('products', 'id,sku,barcode', 'name')
          const byBarcode = new Map(created.map((p) => [norm(String(p.barcode ?? '')), String(p.id)]))
          const bySku = new Map(created.map((p) => [norm(String(p.sku ?? '')), String(p.id)]))
          const mins: { org_id: string; branch_id: string; product_id: string; min_stock: number }[] = []
          for (const [bc, min] of minByBarcode) {
            const pid = byBarcode.get(bc)
            if (pid) mins.push({ org_id: orgId, branch_id: branch!.id, product_id: pid, min_stock: min })
            else minsSkipped.push(bc)
          }
          for (const [sk, min] of minBySku) {
            const pid = bySku.get(sk)
            if (pid) mins.push({ org_id: orgId, branch_id: branch!.id, product_id: pid, min_stock: min })
            else minsSkipped.push(sk)
          }
          for (const chunk of chunked(mins, 200)) {
            const { error } = await supabase.from('branch_inventory').upsert(chunk, { onConflict: 'org_id,branch_id,product_id' })
            if (error) throw error
            minsApplied += chunk.length
          }
        }
        skipped += rejected
        setNote({ ok: true, text: `Products import complete: ${imported} imported, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped, ${preview.invalid.length} invalid.${minsApplied ? ` Min Stock applied to ${minsApplied} product${minsApplied === 1 ? '' : 's'} at ${branch.name}.` : ''}${minsSkipped.length ? ` Min Stock not matched for: ${minsSkipped.slice(0, 5).join(', ')}${minsSkipped.length > 5 ? '…' : ''}.` : ''}` })
      } else if (kind === 'customers') {
        // Balance is never imported: every insert starts at 0 (guard_ledger).
        const rows = preview.valid as CustomerImport[]
        const payloads = rows.map((r) => ({
          org_id: orgId, name: r.name, phone: r.phone, email: r.email,
          address: r.address, credit_limit: r.credit_limit, balance: 0, is_active: r.is_active,
        }))
        for (const chunk of chunked(payloads, 200)) {
          const { error } = await supabase.from('customers').insert(chunk)
          if (error) throw error
          imported += chunk.length
        }
        skipped += rejected
        setNote({ ok: true, text: `Customers import complete: ${imported} imported, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped, ${preview.invalid.length} invalid. Balances start at zero and move only through sales and voids.` })
      } else if (kind === 'suppliers') {
        const rows = preview.valid as SupplierImport[]
        const payloads = rows.map((r) => ({
          org_id: orgId, name: r.name, contact_person: r.contact_person,
          phone: r.phone, email: r.email, address: r.address, is_active: r.is_active,
        }))
        for (const chunk of chunked(payloads, 200)) {
          const { error } = await supabase.from('suppliers').insert(chunk)
          if (error) throw error
          imported += chunk.length
        }
        skipped += rejected
        setNote({ ok: true, text: `Suppliers import complete: ${imported} imported, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped, ${preview.invalid.length} invalid.` })
      } else if (kind === 'expenses') {
        // Re-uploading the same file creates new rows: duplicates are informational only.
        const cats = await pageThrough('expense_categories', 'id,name', 'name')
        const catId = new Map(cats.map((c) => [norm(String(c.name)), String(c.id)]))
        const rows = preview.valid as ExpenseImport[]
        const payloads = rows.map((r) => ({
          org_id: orgId, branch_id: r.branch_id, category_id: catId.get(norm(r.category)) ?? r.category,
          amount: r.amount, description: r.description, payment_method: r.payment_method, expense_date: r.expense_date,
        }))
        for (const chunk of chunked(payloads, 200)) {
          const { error } = await supabase.from('expenses').insert(chunk)
          if (error) throw error
          imported += chunk.length
        }
        skipped += rejected
        setNote({ ok: true, text: `Expenses import complete: ${imported} imported, ${skipped} within-file duplicate${skipped === 1 ? '' : 's'} skipped, ${preview.invalid.length} invalid.` })
      } else {
        // Inventory: legitimate ledger transactions only (never direct stock writes).
        const prods = await pageThrough('products', 'id,sku', 'name')
        const prodId = new Map(prods.map((p) => [norm(String(p.sku)), String(p.id)]))
        const stock = await pageThrough('branch_inventory', 'branch_id,product_id,stock_qty', 'product_id')
        const stockOf = new Map(stock.map((s) => [`${String(s.product_id)}|${String(s.branch_id)}`, Number(s.stock_qty ?? 0)]))
        const rows = preview.valid as InventoryImport[]
        const txns: { org_id: string; branch_id: string; product_id: string; qty_change: number; reason: string; note: string | null }[] = []
        for (const r of rows) {
          const pid = prodId.get(norm(r.sku))
          if (!pid) continue
          let change = r.quantity
          if (r.reason === 'damaged' || r.reason === 'expired') change = -Math.abs(change)
          if (r.reason === 'opening') change = Math.abs(change)
          if (r.reason === 'count') change = change - (stockOf.get(`${pid}|${r.branch_id}`) ?? 0)
          if (change === 0) { skipped += 1; continue }
          txns.push({ org_id: orgId, branch_id: r.branch_id, product_id: pid, qty_change: change, reason: r.reason, note: r.note })
        }
        for (const chunk of chunked(txns, 200)) {
          const { error } = await supabase.from('inventory_transactions').insert(chunk)
          if (error) throw error
          imported += chunk.length
        }
        skipped += rejected
        setNote({ ok: true, text: `Inventory import complete: ${imported} ledger ${imported === 1 ? 'entry' : 'entries'} recorded, ${skipped} skipped, ${preview.invalid.length} invalid. Stock history is preserved on the Inventory page.` })
      }

      refreshAfter(kind)
      setPreview(null)
    } catch (e) {
      setNote({ ok: false, text: friendly(e) })
    } finally {
      setProcessing(false)
    }
  }

  const section = (
    key: string,
    title: string,
    hint: string,
    exportBtn: React.ReactNode,
    importKind?: ImportKind,
  ) => (
    <Card className="p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight text-ink-900">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {exportBtn}
          {importKind && (
            <>
              <Btn type="button" onClick={() => downloadTemplate(importKind)} title={`Download the ${title.toLowerCase()} CSV template`}>
                <CrudIcon name="print" /> Template
              </Btn>
              <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-brand-100 bg-white px-4 py-2 text-sm font-medium text-brand-800 shadow-sm transition-colors hover:bg-brand-50 focus-within:outline-2 focus-within:outline-brand-600">
                <CrudIcon name="add" /> Choose file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  aria-label={`Upload ${title.toLowerCase()} CSV`}
                  className="sr-only"
                  disabled={busy !== null}
                  onChange={(e) => { void onFile(importKind, e.target.files?.[0]); e.target.value = '' }}
                />
              </label>
            </>
          )}
        </div>
      </div>
    </Card>
  )

  if (!org) {
    return (
      <div className={pageCanvasCls}>
        <PageHeaderOnDark title="Data Management" description="Bulk import and export." />
        <Notice tone="warn">Choose a business first — imports and exports belong to the current business only.</Notice>
      </div>
    )
  }

  return (
    <div className={pageCanvasCls}>
      <PageHeaderOnDark
        title="Data Management"
        description="Bulk import and export. Imports are validated before anything is saved — nothing imports silently."
      />
      {note && <Notice tone={note.ok ? 'ok' : 'err'}>{note.text}</Notice>}

      <div className={filterBarCls}>
        <p className="text-xs text-slate-500">
          Workflow: download the template → fill it in → choose the file → review the preview → confirm.
          Sales and purchases are export-only: bulk import would bypass the POS and receiving ledgers.
          Files are limited to 5 MB / 5,000 rows.
        </p>
      </div>

      <div className="grid gap-4 sm:gap-5">
        {canViewProducts && section('products', 'Products', 'SKU is automatic — leave it blank and one is assigned, or supply your own unique SKU. A Min Stock value applies to the current branch only; blank leaves minimums untouched.',
          <Btn type="button" disabled={busy !== null} onClick={() => void exportProducts()}>{busy === 'products' ? <Spinner label="Exporting…" /> : <><CrudIcon name="print" /> Export</>}</Btn>, canEditProducts ? 'products' : undefined)}
        {canViewCustomers && section('customers', 'Customers', 'Balances are never imported — new customers start at zero; balances move only through sales and voids. Export shows the read-only balance.',
          <Btn type="button" disabled={busy !== null} onClick={() => void exportCustomers()}>{busy === 'customers' ? <Spinner label="Exporting…" /> : <><CrudIcon name="print" /> Export</>}</Btn>, canEditCustomers ? 'customers' : undefined)}
        {canViewSuppliers && section('suppliers', 'Suppliers', 'Matched by name. Deactivation (not deletion) removes a supplier from day-to-day use.',
          <Btn type="button" disabled={busy !== null} onClick={() => void exportSuppliers()}>{busy === 'suppliers' ? <Spinner label="Exporting…" /> : <><CrudIcon name="print" /> Export</>}</Btn>, canEditSuppliers ? 'suppliers' : undefined)}
        {canViewInventory && section('inventory', 'Inventory', 'Every row becomes a ledger entry (opening/adjustment/damaged/expired/count) — stock is never overwritten directly.',
          <Btn type="button" disabled={busy !== null} onClick={() => void exportInventory()}>{busy === 'inventory' ? <Spinner label="Exporting…" /> : <><CrudIcon name="print" /> Export</>}</Btn>, canAdjustInventory ? 'inventory' : undefined)}
        {canViewExpenses && section('expenses', 'Expenses', 'Branch and category must already exist. Re-uploading the same file creates duplicates — each valid row is a new expense.',
          <Btn type="button" disabled={busy !== null} onClick={() => void exportExpenses()}>{busy === 'expenses' ? <Spinner label="Exporting…" /> : <><CrudIcon name="print" /> Export</>}</Btn>, canEditExpenses ? 'expenses' : undefined)}
        {canSalesExport && section('sales', 'Sales (export-only)', 'Completed and void sales with branch, customer and totals. Sales cannot be imported — that would corrupt inventory, payments, tax and audit.',
          <Btn type="button" disabled={busy !== null} onClick={() => void exportSales()}>{busy === 'sales' ? <Spinner label="Exporting…" /> : <><CrudIcon name="print" /> Export</>}</Btn>)}
        {canPurchasesView && section('purchases', 'Purchases (export-only)', 'Draft, received and cancelled purchases with supplier and branch. Purchases are created and received on the Purchases page.',
          <Btn type="button" disabled={busy !== null} onClick={() => void exportPurchases()}>{busy === 'purchases' ? <Spinner label="Exporting…" /> : <><CrudIcon name="print" /> Export</>}</Btn>)}
      </div>

      {preview && (
        <Dialog label={`Preview — ${preview.fileName}`} wide onClose={() => setPreview(null)}>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-brand-50 px-3 py-1 font-semibold text-brand-800 ring-1 ring-inset ring-brand-200">{preview.total} total</span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">{preview.valid.length} valid</span>
            <span className="rounded-full bg-red-50 px-3 py-1 font-semibold text-red-800 ring-1 ring-inset ring-red-200">{preview.invalid.length} invalid</span>
            <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">{preview.duplicates.length} duplicates</span>
          </div>
          {preview.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
          {(preview.invalid.length > 0 || preview.duplicates.length > 0) && (
            <div className="scroll-slim max-h-56 overflow-auto">
              <TableShell label="Row issues">
                <thead><tr><th className={thCls}>Row</th><th className={thCls}>Issue</th></tr></thead>
                <tbody>
                  {[...preview.invalid, ...preview.duplicates].slice(0, 100).map((r, i) => (
                    <tr key={i} className={rowCls}>
                      <td className={`${tdCls} font-mono`}>{r.index}</td>
                      <td className={tdCls}>{r.errors.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
          )}
          {preview.duplicates.length > 0 && (
            <Field label="Duplicates">
              <select value={dupMode} onChange={(e) => setDupMode(e.target.value as DupMode)} className={`${selectCls} w-full`} aria-label="How to handle duplicates">
                <option value="skip">Skip duplicates (recommended)</option>
                <option value="reject">Reject the whole file</option>
              </select>
            </Field>
          )}
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            <Btn type="button" onClick={() => setPreview(null)}><CrudIcon name="close" /> Fix file & re-upload</Btn>
            <Btn
              type="button"
              variant="primary"
              disabled={processing || preview.valid.length === 0 || preview.invalid.length > 0 || (dupMode === 'reject' && preview.duplicates.length > 0)}
              title={preview.invalid.length > 0 ? 'Fix the invalid rows and re-upload before confirming' : 'Import the valid rows'}
              onClick={() => void confirmImport()}
            >
              {processing ? <Spinner label="Importing…" /> : <><CrudIcon name="save" /> Confirm import ({preview.valid.length})</>}
            </Btn>
          </div>
          <p className="text-xs text-slate-500">
            {preview.invalid.length > 0
              ? 'Fix the file and re-upload — nothing has been imported yet.'
              : 'Confirming imports the valid rows above. Duplicates are skipped unless you chose Reject.'}
          </p>
        </Dialog>
      )}
    </div>
  )
}
