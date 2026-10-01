// Phase 5C — report export helpers (display-only, dependency-free).
// Every export reuses rows the Reports page already fetched under RLS; nothing
// here queries the database, bypasses authorization, or recalculates money.
// - CSV: RFC-4180 escaping so commas/quotes/line-breaks in names survive.
// - XLSX: minimal "stored" (uncompressed) ZIP of SpreadsheetML with inline
//   strings — valid for Excel/Sheets/LibreOffice, no third-party library.
// - PDF: printable report document opened in a print window (user saves/prints
//   to PDF); multi-section so it paginates instead of one giant layout.
export type ExportMeta = {
  orgName: string
  currency: string
  branchScope: string // e.g. "Organization-wide" or a branch name
  rangeLabel: string // e.g. "This Month" or "2026-09-01 to 2026-09-30"
  generatedAt: string // display string
}

export type ExportSummary = {
  revenue: number
  cogs: number
  gross: number
  expenses: number
  net: number
  purchaseTotal: number
  stockValue: number
  salesCount: number
  purchaseCount: number
  expenseCount: number
  stockLines: number
}

export type SalesExportRow = { date: string; id: string; branch: string; total: number; status: string }
export type PurchaseExportRow = { date: string; id: string; supplier: string; branch: string; total: number; status: string }
export type ExpenseExportRow = { date: string; description: string; category: string; branch: string; method: string; amount: number }
export type InventoryExportRow = { stockQty: number; costPrice: number; lineValue: number }

export const EXPORT_CSV_NAME = 'AiroLink-Report.csv'
export const EXPORT_XLSX_NAME = 'AiroLink-Report.xlsx'

export const moneyText = (currency: string, n: number) => `${currency} ${Number(n).toFixed(2)}`

// RFC-4180: quote when the field holds a comma, quote, or line break;
// embedded quotes double up.
export function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const csvLine = (cells: (string | number)[]) => cells.map(csvEscape).join(',')

export function buildReportCsv(args: {
  meta: ExportMeta
  summary: ExportSummary
  sales: SalesExportRow[]
  purchases: PurchaseExportRow[]
  expenses: ExpenseExportRow[]
  inventory: InventoryExportRow[]
}): string {
  const { meta, summary, sales, purchases, expenses, inventory } = args
  const m = (n: number) => moneyText(meta.currency, n)
  const L: string[] = [
    csvLine(['AiroLink POS - Financial Report']),
    csvLine(['Organization', meta.orgName]),
    csvLine(['Scope', meta.branchScope]),
    csvLine(['Date range', meta.rangeLabel]),
    csvLine(['Generated', meta.generatedAt]),
    '',
    csvLine(['Summary']),
    csvLine(['Metric', 'Value']),
    csvLine(['Revenue (sales)', m(summary.revenue)]),
    csvLine(['COGS', m(summary.cogs)]),
    csvLine(['Gross profit', m(summary.gross)]),
    csvLine(['Expenses', m(summary.expenses)]),
    csvLine(['Net profit', m(summary.net)]),
    csvLine(['Purchase total', m(summary.purchaseTotal)]),
    csvLine(['Inventory valuation', m(summary.stockValue)]),
    '',
    csvLine(['Sales report']),
    csvLine(['Date', 'Sale ID', 'Branch', 'Total', 'Status']),
    ...sales.map((s) => csvLine([s.date, s.id, s.branch, m(s.total), s.status])),
    '',
    csvLine(['Purchase report']),
    csvLine(['Date', 'Purchase ID', 'Supplier', 'Branch', 'Total', 'Status']),
    ...purchases.map((p) => csvLine([p.date, p.id, p.supplier, p.branch, m(p.total), p.status])),
    '',
    csvLine(['Expense report']),
    csvLine(['Date', 'Expense', 'Category', 'Branch', 'Payment method', 'Amount']),
    ...expenses.map((e) => csvLine([e.date, e.description, e.category, e.branch, e.method, m(e.amount)])),
    '',
    csvLine(['Inventory valuation']),
    csvLine(['Stock qty', 'Cost price', 'Line value']),
    ...inventory.map((r) => csvLine([r.stockQty, m(r.costPrice), m(r.lineValue)])),
    '',
  ]
  return L.join('\r\n')
}

// ---------- Minimal XLSX (stored ZIP + inline strings, no dependencies) ----------

type Sheet = { name: string; rows: (string | number)[][] }

export function reportSheets(args: {
  meta: ExportMeta
  summary: ExportSummary
  sales: SalesExportRow[]
  purchases: PurchaseExportRow[]
  expenses: ExpenseExportRow[]
  inventory: InventoryExportRow[]
}): Sheet[] {
  const { meta, summary, sales, purchases, expenses, inventory } = args
  const m = (n: number) => moneyText(meta.currency, n)
  const sheets: Sheet[] = [
    {
      name: 'Summary',
      rows: [
        ['AiroLink POS - Financial Report'],
        ['Organization', meta.orgName],
        ['Scope', meta.branchScope],
        ['Date range', meta.rangeLabel],
        ['Generated', meta.generatedAt],
        [],
        ['Metric', 'Value'],
        ['Revenue (sales)', m(summary.revenue)],
        ['COGS', m(summary.cogs)],
        ['Gross profit', m(summary.gross)],
        ['Expenses', m(summary.expenses)],
        ['Net profit', m(summary.net)],
        ['Purchase total', m(summary.purchaseTotal)],
        ['Inventory valuation', m(summary.stockValue)],
      ],
    },
  ]
  if (sales.length > 0) {
    sheets.push({
      name: 'Sales',
      rows: [
        ['Date', 'Sale ID', 'Branch', 'Total', 'Status'],
        ...sales.map((s): (string | number)[] => [s.date, s.id, s.branch, m(s.total), s.status]),
      ],
    })
  }
  if (purchases.length > 0) {
    sheets.push({
      name: 'Purchases',
      rows: [
        ['Date', 'Purchase ID', 'Supplier', 'Branch', 'Total', 'Status'],
        ...purchases.map((p): (string | number)[] => [p.date, p.id, p.supplier, p.branch, m(p.total), p.status]),
      ],
    })
  }
  if (expenses.length > 0) {
    sheets.push({
      name: 'Expenses',
      rows: [
        ['Date', 'Expense', 'Category', 'Branch', 'Payment method', 'Amount'],
        ...expenses.map((e): (string | number)[] => [e.date, e.description, e.category, e.branch, e.method, m(e.amount)]),
      ],
    })
  }
  if (inventory.length > 0) {
    sheets.push({
      name: 'Inventory',
      rows: [
        ['Stock qty', 'Cost price', 'Line value'],
        ...inventory.map((r): (string | number)[] => [r.stockQty, m(r.costPrice), m(r.lineValue)]),
      ],
    })
  }
  return sheets
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const colName = (i: number) => {
  let n = i
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

function sheetXml(rows: (string | number)[][]): string {
  const body = rows
    .map((cells, r) => {
      const tds = cells
        .map((c, i) => {
          const ref = `${colName(i)}${r + 1}`
          return typeof c === 'number'
            ? `<c r="${ref}"><v>${c}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(c))}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${tds}</row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// Uncompressed ZIP writer (method 0/"stored" is always valid ZIP).
function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const dosTime = ((11 << 11) | (0 << 5) | 0) & 0xffff // 11:00
  const dosDate = (((2026 - 1980) << 9) | (10 << 5) | 1) & 0xffff
  const push32 = (arr: number[], v: number) => {
    arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)
  }
  const push16 = (arr: number[], v: number) => {
    arr.push(v & 0xff, (v >>> 8) & 0xff)
  }
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const lh: number[] = [0x50, 0x4b, 0x03, 0x04]
    push16(lh, 20); push16(lh, 0x0800); push16(lh, 0); push16(lh, dosTime); push16(lh, dosDate)
    push32(lh, crc); push32(lh, f.data.length); push32(lh, f.data.length)
    push16(lh, name.length); push16(lh, 0)
    const head = new Uint8Array(lh)
    chunks.push(head, name, f.data)
    const ch: number[] = [0x50, 0x4b, 0x01, 0x02]
    push16(ch, 20); push16(ch, 20); push16(ch, 0x0800); push16(ch, 0)
    push16(ch, dosTime); push16(ch, dosDate)
    push32(ch, crc); push32(ch, f.data.length); push32(ch, f.data.length)
    push16(ch, name.length); push16(ch, 0); push16(ch, 0); push16(ch, 0); push16(ch, 0)
    push32(ch, 0); push32(ch, offset)
    const cHead = new Uint8Array(ch)
    central.push(cHead, name)
    offset += head.length + name.length + f.data.length
  }
  let centralSize = 0
  for (const c of central) centralSize += c.length
  const end: number[] = [0x50, 0x4b, 0x05, 0x06]
  push16(end, 0); push16(end, 0); push16(end, files.length); push16(end, files.length)
  push32(end, centralSize); push32(end, offset); push16(end, 0)
  const out = new Uint8Array(offset + centralSize + end.length)
  let p = 0
  for (const c of [...chunks, ...central, new Uint8Array(end)]) {
    out.set(c, p)
    p += c.length
  }
  return out
}

export function buildReportXlsx(args: {
  meta: ExportMeta
  summary: ExportSummary
  sales: SalesExportRow[]
  purchases: PurchaseExportRow[]
  expenses: ExpenseExportRow[]
  inventory: InventoryExportRow[]
}): Uint8Array {
  const enc = new TextEncoder()
  const sheets = reportSheets(args)
  const rels = sheets
    .map(
      (s, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')
  const files = [
    {
      name: '[Content_Types].xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/styles.xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`,
      ),
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s.rows)) })),
  ]
  return zipStored(files)
}

// ---------- Browser download + printable PDF ----------

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
}

export function downloadCsvFile(csv: string) {
  downloadBlob(EXPORT_CSV_NAME, new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
}

export function downloadXlsxFile(bytes: Uint8Array) {
  const buf = new ArrayBuffer(bytes.length)
  new Uint8Array(buf).set(bytes)
  downloadBlob(
    EXPORT_XLSX_NAME,
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  )
}

const htmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function pdfTable(headers: string[], rows: string[][]): string {
  return `<table><thead><tr>${headers.map((h) => `<th>${htmlEscape(h)}</th>`).join('')}</tr></thead><tbody>${
    rows.length === 0
      ? `<tr><td colspan="${headers.length}" class="muted">No rows in this period.</td></tr>`
      : rows.map((r) => `<tr>${r.map((c) => `<td>${htmlEscape(c)}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`
}

// Opens a printable report document (user prints/saves to PDF). Throws a
// friendly Error when the browser blocks the popup so the UI can explain it.
export function printReportPdf(args: {
  meta: ExportMeta
  summary: ExportSummary
  sales: SalesExportRow[]
  purchases: PurchaseExportRow[]
  expenses: ExpenseExportRow[]
  inventory: InventoryExportRow[]
}): void {
  const { meta, summary, sales, purchases, expenses, inventory } = args
  const m = (n: number) => moneyText(meta.currency, n)
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) throw new Error('The browser blocked the print window. Please allow popups for this site and try again.')
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>AiroLink POS - Financial Report</title><style>
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:13px}
.h{display:flex;align-items:center;gap:12px;border-bottom:3px solid #1c6dd9;padding-bottom:12px}
.h img{width:44px;height:44px;object-fit:cover;border-radius:8px}
.h h1{font-size:20px;margin:0}.h p{margin:2px 0 0;color:#555;font-size:12px}
.meta{margin:12px 0;color:#333}.meta b{display:inline-block;min-width:110px}
.sec{margin-top:22px;page-break-inside:avoid}h2{font-size:15px;margin:0 0 6px;color:#0b2545}
table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;font-size:12px}
th{background:#eff6ff}tr:nth-child(even) td{background:#f8fafc}.muted{color:#64748b}
.sum{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:6px}
.sum div{border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px}.sum small{color:#64748b}
@media print{.noprint{display:none}}
</style></head><body>
<div class="h"><img src="/airolink-logo.jpeg" alt=""><div><h1>AiroLink POS — Financial Report</h1><p>Advanced Elevated Technology</p></div></div>
<div class="meta"><div><b>Organization:</b> ${htmlEscape(meta.orgName)}</div><div><b>Scope:</b> ${htmlEscape(meta.branchScope)}</div><div><b>Date range:</b> ${htmlEscape(meta.rangeLabel)}</div><div><b>Generated:</b> ${htmlEscape(meta.generatedAt)}</div></div>
<div class="sec"><h2>Financial summary</h2><div class="sum">
<div><small>Revenue (sales)</small><div><b>${htmlEscape(m(summary.revenue))}</b></div></div>
<div><small>COGS</small><div><b>${htmlEscape(m(summary.cogs))}</b></div></div>
<div><small>Gross profit</small><div><b>${htmlEscape(m(summary.gross))}</b></div></div>
<div><small>Expenses</small><div><b>${htmlEscape(m(summary.expenses))}</b></div></div>
<div><small>Net profit</small><div><b>${htmlEscape(m(summary.net))}</b></div></div>
<div><small>Purchase total</small><div><b>${htmlEscape(m(summary.purchaseTotal))}</b></div></div>
<div><small>Inventory valuation</small><div><b>${htmlEscape(m(summary.stockValue))}</b></div></div>
</div></div>
<div class="sec"><h2>Profit &amp; loss</h2>${pdfTable(['Line', 'Amount'], [['Revenue', m(summary.revenue)], ['COGS', m(summary.cogs)], ['Gross profit', m(summary.gross)], ['Expenses', m(summary.expenses)], ['Net profit', m(summary.net)]])}</div>
<div class="sec"><h2>Sales report</h2>${pdfTable(['Date', 'Sale ID', 'Branch', 'Total', 'Status'], sales.map((s) => [s.date, s.id, s.branch, m(s.total), s.status]))}</div>
<div class="sec"><h2>Purchase report</h2>${pdfTable(['Date', 'Purchase ID', 'Supplier', 'Branch', 'Total', 'Status'], purchases.map((p) => [p.date, p.id, p.supplier, p.branch, m(p.total), p.status]))}</div>
<div class="sec"><h2>Expense report</h2>${pdfTable(['Date', 'Expense', 'Category', 'Branch', 'Payment method', 'Amount'], expenses.map((e) => [e.date, e.description, e.category, e.branch, e.method, m(e.amount)]))}</div>
<div class="sec"><h2>Inventory valuation</h2>${pdfTable(['Stock qty', 'Cost price', 'Line value'], inventory.map((r) => [String(r.stockQty), m(r.costPrice), m(r.lineValue)]))}</div>
<p class="noprint" style="margin-top:24px"><button onclick="window.print()" style="padding:10px 18px;font-size:14px">Print / Save as PDF</button></p>
</body></html>`
  w.document.write(doc)
  w.document.close()
  w.focus()
}
