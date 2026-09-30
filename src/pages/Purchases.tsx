import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
import { r2 } from '../lib/calc'
import {
  Btn, Card, EmptyState, Field, Notice, PageHeader, Spinner, StatusBadge,
  TableShell, inputCls, rowCls, selectCls, tdCls, thCls, filterBarCls,
} from '../components/ui'

const PAGE = 20
type PurchaseRow = {
  id: string; ref_no: string; status: string; total: number; note: string | null
  branch_id: string; supplier_id: string; received_at: string | null; created_at: string
  suppliers: { name: string } | null
}
type Supplier = { id: string; name: string }
type Product = { id: string; name: string; sku: string; cost_price: number }
type DraftLine = { product_id: string; qty: string; unit_cost: string }
type DetailItem = { product_id: string; qty: number; unit_cost: number; line_total: number; products: { name: string; sku: string } | null }

const statusTone = (s: string): 'amber' | 'green' | 'slate' => (s === 'draft' ? 'amber' : s === 'received' ? 'green' : 'slate')

export default function Purchases() {
  const { org, branch, branches } = useAuth(); const qc = useQueryClient()
  const [page, setPage] = useState(0); const [refQ, setRefQ] = useState('')
  const [branchId, setBranchId] = useState(''); const [supplierId, setSupplierId] = useState(''); const [status, setStatus] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formBranch, setFormBranch] = useState('')
  const [formSupplier, setFormSupplier] = useState('')
  const [formNote, setFormNote] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([{ product_id: '', qty: '', unit_cost: '' }])
  const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null)
  const canEdit = allowed('editPurchases', org?.role)
  const reset = () => setPage(0)
  // Reset page-local state on organization change so the old org's filters never linger.
  useEffect(() => {
    setPage(0); setRefQ(''); setBranchId(''); setSupplierId(''); setStatus(''); setDetailId(null)
    setFormOpen(false); setFormBranch(''); setFormSupplier(''); setFormNote('')
    setLines([{ product_id: '', qty: '', unit_cost: '' }]); setNote(null)
  }, [org!.id])
  // Default the draft form's branch to the current branch once branches load.
  useEffect(() => { if (formOpen && !formBranch && branch) setFormBranch(branch.id) }, [formOpen, formBranch, branch])

  const supplierOpts = useQuery({ queryKey: ['suppliers', org!.id, 'purchase-filters'], queryFn: async () => {
    const { data, error } = await supabase.from('suppliers').select('id,name').eq('org_id', org!.id).eq('is_active', true).order('name').limit(200)
    if (error) throw error; return (data ?? []) as Supplier[]
  } })
  // RLS already limits rows to the branches this user may see; the branch filter only narrows further.
  const list = useQuery({ queryKey: ['purchases', org!.id, branchId, supplierId, status, page, refQ], queryFn: async () => {
    let s = supabase.from('purchases').select('id,ref_no,status,total,note,branch_id,supplier_id,received_at,created_at,suppliers(name)', { count: 'exact' }).eq('org_id', org!.id)
    if (branchId) s = s.eq('branch_id', branchId)
    if (supplierId) s = s.eq('supplier_id', supplierId)
    if (status) s = s.eq('status', status)
    if (refQ.trim()) s = s.ilike('ref_no', `%${refQ.trim().replace(/[,()%]/g, '')}%`)
    const { data, error, count } = await s.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw error
    return { rows: (data ?? []) as unknown as PurchaseRow[], count: count ?? 0 }
  } })
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '—'

  const products = useQuery({ queryKey: ['products', org!.id, 'purchase-form'], enabled: formOpen, queryFn: async () => {
    const { data, error } = await supabase.from('products').select('id,name,sku,cost_price').eq('org_id', org!.id).eq('is_active', true).order('name').limit(500)
    if (error) throw error; return (data ?? []) as Product[]
  } })
  const productById = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data])
  // Preview only: the RPC recomputes every total server-side.
  const preview = useMemo(() => {
    const rows = lines.map((l) => {
      const qty = Number(l.qty) || 0
      const cost = l.unit_cost === '' ? 0 : Number(l.unit_cost) || 0
      return { ...l, qty, cost, total: r2(Math.max(qty, 0) * Math.max(cost, 0)) }
    })
    return { rows, total: r2(rows.reduce((s, x) => s + x.total, 0)) }
  }, [lines])
  const draftValid = formBranch && formSupplier && preview.rows.length > 0
    && preview.rows.every((l) => l.product_id && l.unit_cost !== '' && !Number.isNaN(Number(l.qty)) && !Number.isNaN(Number(l.unit_cost)) && l.qty > 0 && l.cost >= 0)
    && new Set(preview.rows.map((l) => l.product_id)).size === preview.rows.length

  const invalidateAfterWrite = () => {
    void qc.invalidateQueries({ queryKey: ['purchases'] })
    void qc.invalidateQueries({ queryKey: ['purchase'] })
  }
  const invalidateAfterReceive = () => {
    invalidateAfterWrite()
    // Receiving moves stock and re-stamps product cost: every stock/cost view goes stale.
    void qc.invalidateQueries({ queryKey: ['branch_inventory'] })
    void qc.invalidateQueries({ queryKey: ['pos-stock'] })
    void qc.invalidateQueries({ queryKey: ['inv-history'] })
    void qc.invalidateQueries({ queryKey: ['products'] })
    void qc.invalidateQueries({ queryKey: ['inv-products'] })
    void qc.invalidateQueries({ queryKey: ['pos-search'] })
  }

  const createDraft = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_draft_purchase', {
        p_org: org!.id, p_branch: formBranch, p_supplier: formSupplier,
        p_note: formNote.trim() || null,
        p_items: preview.rows.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_cost: l.cost })),
      })
      if (error) throw error; return data as string
    },
    onSuccess: () => {
      setNote({ ok: true, t: 'Draft purchase saved. Receive it to update stock.' })
      setFormOpen(false); setFormSupplier(''); setFormNote(''); setLines([{ product_id: '', qty: '', unit_cost: '' }])
      invalidateAfterWrite()
    },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const receive = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc('receive_purchase', { p_org: org!.id, p_purchase: id }); if (error) throw error },
    onSuccess: () => { setNote({ ok: true, t: 'Purchase received. Stock increased and product costs updated.' }); setDetailId(null); invalidateAfterReceive() },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const cancel = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc('cancel_purchase', { p_org: org!.id, p_purchase: id, p_reason: null }); if (error) throw error },
    onSuccess: () => { setNote({ ok: true, t: 'Draft purchase cancelled.' }); setDetailId(null); invalidateAfterWrite() },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })

  const detail = useQuery({ queryKey: ['purchase', org!.id, detailId ?? 'none'], enabled: !!detailId, queryFn: async () => {
    const { data: p, error } = await supabase.from('purchases').select('id,ref_no,status,total,note,branch_id,supplier_id,received_at,created_at,suppliers(name)').eq('org_id', org!.id).eq('id', detailId!).maybeSingle()
    if (error) throw error; if (!p) throw new Error('Purchase not found')
    const { data: items, error: itemsError } = await supabase.from('purchase_items').select('product_id,qty,unit_cost,line_total,products(name,sku)').eq('purchase_id', detailId!)
    if (itemsError) throw itemsError
    return { purchase: p as unknown as PurchaseRow, items: (items ?? []) as unknown as DetailItem[] }
  } })

  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, k) => k === i ? { ...l, ...patch } : l))
  const pickProduct = (i: number, productId: string) => {
    const p = productById.get(productId)
    setLine(i, { product_id: productId, unit_cost: p ? String(Number(p.cost_price)) : '' })
  }
  const pages = Math.max(1, Math.ceil((list.data?.count ?? 0) / PAGE))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchases"
        description="Purchase orders, goods receiving and purchase history."
        actions={canEdit ? (
          <Btn variant="primary" onClick={() => setFormOpen((v) => !v)} aria-expanded={formOpen}>
            {formOpen ? 'Close form' : '+ New purchase'}
          </Btn>
        ) : undefined}
      />
      {note && <Notice tone={note.ok ? 'ok' : 'err'}>{note.t}</Notice>}

      {canEdit && formOpen && (
        <Card className="space-y-3 p-4 sm:p-5">
          <p className="text-sm font-semibold text-slate-900">New purchase (saved as a draft — stock moves only when it is received)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier" required>
              <select value={formSupplier} onChange={(e) => setFormSupplier(e.target.value)} className={`${selectCls} w-full`}>
                <option value="">Select a supplier</option>
                {supplierOpts.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Receiving branch" required>
              <select value={formBranch} onChange={(e) => setFormBranch(e.target.value)} className={`${selectCls} w-full`}>
                <option value="">Select a branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Note (optional)">
            <input value={formNote} onChange={(e) => setFormNote(e.target.value)} placeholder="e.g. invoice number" className={inputCls} />
          </Field>
          {products.isLoading ? (
            <p className="py-2"><Spinner label="Loading products…" /></p>
          ) : products.isError ? (
            <Notice tone="err">Could not load products. <button className="font-medium underline" onClick={() => products.refetch()}>Retry</button></Notice>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_7rem_7rem_auto]">
                  <Field label={i === 0 ? 'Product' : ''}>
                    <select aria-label={`Line ${i + 1} product`} value={l.product_id} onChange={(e) => pickProduct(i, e.target.value)} className={`${selectCls} w-full`}>
                      <option value="">Select a product</option>
                      {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                    </select>
                  </Field>
                  <Field label={i === 0 ? 'Qty' : ''}>
                    <input aria-label={`Line ${i + 1} quantity`} type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="0" className={`${inputCls} sm:w-28`} />
                  </Field>
                  <Field label={i === 0 ? 'Unit cost' : ''}>
                    <input aria-label={`Line ${i + 1} unit cost`} type="number" min={0} step="any" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} placeholder="0.00" className={`${inputCls} sm:w-28`} />
                  </Field>
                  <div className="flex items-center gap-2">
                    <span className="min-w-[4.5rem] text-right font-mono text-sm font-medium">{org!.currency} {(preview.rows[i]?.total ?? 0).toFixed(2)}</span>
                    {lines.length > 1 && <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded px-1.5 py-1 text-red-700 hover:bg-red-50" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>✕</button>}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setLines((ls) => [...ls, { product_id: '', qty: '', unit_cost: '' }])} className="text-sm font-medium text-brand-700 hover:underline">+ Add line</button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-brand-100 pt-3">
            <p className="text-sm text-slate-600">Total <strong className="font-mono text-base text-ink-900">{org!.currency} {preview.total.toFixed(2)}</strong></p>
            <div className="flex gap-2">
              <Btn type="button" onClick={() => setFormOpen(false)}>Cancel</Btn>
              <Btn variant="primary" disabled={!draftValid || createDraft.isPending} onClick={() => createDraft.mutate()}>
                {createDraft.isPending ? 'Saving…' : 'Save draft'}
              </Btn>
            </div>
          </div>
          {!draftValid && lines.length > 0 && (
            <p className="text-xs text-slate-500">Choose a supplier, branch, and at least one product with quantity and unit cost (no duplicates).</p>
          )}
        </Card>
      )}

      <div className={filterBarCls}>
        <input value={refQ} onChange={(e) => { setRefQ(e.target.value); reset() }} placeholder="Reference number" aria-label="Reference number" className={`${inputCls} sm:max-w-[12rem]`} />
        {branches.length > 1 && <select value={branchId} onChange={(e) => { setBranchId(e.target.value); reset() }} aria-label="Branch filter" className={selectCls}><option value="">All my branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); reset() }} aria-label="Supplier filter" className={selectCls}><option value="">All suppliers</option>{supplierOpts.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); reset() }} aria-label="Status filter" className={selectCls}><option value="">Any status</option><option value="draft">Draft</option><option value="received">Received</option><option value="cancelled">Cancelled</option></select>
      </div>

      <TableShell label="Purchases">
        <thead>
          <tr>
            {['Reference', 'Date', 'Branch', 'Supplier', 'Total', 'Status', ''].map((h) => (
              <th key={h} className={thCls}>{h === '' ? <span className="sr-only">Actions</span> : h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.isLoading && <tr><td className="p-4" colSpan={7}><Spinner label="Loading purchases…" /></td></tr>}
          {list.isError && (
            <tr><td className="p-4 text-red-700" colSpan={7}>
              Could not load purchases. <button className="font-medium underline" onClick={() => list.refetch()}>Retry</button>
            </td></tr>
          )}
          {list.data && list.data.rows.length === 0 && (
            <tr><td colSpan={7}><EmptyState title="No purchases match." hint="Try widening the filters — or create a purchase above." /></td></tr>
          )}
          {list.data?.rows.map((r) => (
            <tr key={r.id} className={rowCls}>
              <td className={`${tdCls} font-mono text-xs`}>{r.ref_no}</td>
              <td className={`${tdCls} whitespace-nowrap`}>{new Date(r.created_at).toLocaleString()}</td>
              <td className={tdCls}>{branchName(r.branch_id)}</td>
              <td className={tdCls}>{r.suppliers?.name ?? '—'}</td>
              <td className={`${tdCls} whitespace-nowrap font-medium`}>{org!.currency} {Number(r.total).toFixed(2)}</td>
              <td className={tdCls}><StatusBadge tone={statusTone(r.status)}><span className="capitalize">{r.status}</span></StatusBadge></td>
              <td className={tdCls}><button className="font-medium text-brand-700 hover:underline" onClick={() => setDetailId(r.id)}>View</button></td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <Btn disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Btn>
        <span>Page {page + 1} of {pages}</span>
        <Btn disabled={(page + 1) * PAGE >= (list.data?.count ?? 0)} onClick={() => setPage(page + 1)}>Next</Btn>
      </div>

      {detailId && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setDetailId(null)}>
          <div role="dialog" aria-label="Purchase details" className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl border border-brand-100 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">Purchase {detail.data?.purchase.ref_no ?? '…'}</h2>
              <button type="button" onClick={() => setDetailId(null)} aria-label="Close dialog" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100">✕</button>
            </div>
            {detail.isLoading && <p className="py-4 text-center"><Spinner label="Loading purchase…" /></p>}
            {detail.isError && <Notice tone="err">Could not load this purchase. <button className="font-medium underline" onClick={() => detail.refetch()}>Retry</button></Notice>}
            {detail.data && (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div className="flex justify-between gap-2"><dt className="text-slate-500">Supplier</dt><dd className="font-medium">{detail.data.purchase.suppliers?.name ?? '—'}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-slate-500">Branch</dt><dd className="font-medium">{branchName(detail.data.purchase.branch_id)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-slate-500">Status</dt><dd><StatusBadge tone={statusTone(detail.data.purchase.status)}><span className="capitalize">{detail.data.purchase.status}</span></StatusBadge></dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-slate-500">Total</dt><dd className="font-mono font-semibold">{org!.currency} {Number(detail.data.purchase.total).toFixed(2)}</dd></div>
                  {detail.data.purchase.note && <p className="col-span-2 text-sm text-slate-600">Note: {detail.data.purchase.note}</p>}
                  {detail.data.purchase.received_at && <p className="col-span-2 text-xs text-slate-500">Received {new Date(detail.data.purchase.received_at).toLocaleString()}</p>}
                </dl>
                <TableShell label="Purchase items">
                  <thead><tr><th className={thCls}>Product</th><th className={`${thCls} text-right`}>Qty</th><th className={`${thCls} text-right`}>Unit cost</th><th className={`${thCls} text-right`}>Total</th></tr></thead>
                  <tbody>
                    {detail.data.items.map((it, k) => (
                      <tr key={k} className={rowCls}>
                        <td className={tdCls}>{it.products?.name ?? '—'} <span className="block font-mono text-xs text-slate-500">{it.products?.sku ?? ''}</span></td>
                        <td className={`${tdCls} text-right`}>{Number(it.qty)}</td>
                        <td className={`${tdCls} text-right font-mono`}>{Number(it.unit_cost).toFixed(2)}</td>
                        <td className={`${tdCls} text-right font-mono font-medium`}>{Number(it.line_total).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
                <div className="flex justify-end gap-2">
                  <Btn type="button" onClick={() => setDetailId(null)}>Close</Btn>
                  {canEdit && detail.data.purchase.status === 'draft' && (
                    <>
                      <Btn
                        disabled={cancel.isPending}
                        onClick={() => { const p = detail.data!.purchase; if (confirm(`Cancel purchase ${p.ref_no}? This cannot be undone.`)) cancel.mutate(p.id) }}
                      >
                        {cancel.isPending ? 'Cancelling…' : 'Cancel purchase'}
                      </Btn>
                      <Btn
                        variant="primary"
                        disabled={receive.isPending}
                        onClick={() => { const p = detail.data!.purchase; if (confirm(`Receive ${p.ref_no} at ${branchName(p.branch_id)}? Stock will increase and product costs will be updated.`)) receive.mutate(p.id) }}
                      >
                        {receive.isPending ? 'Receiving…' : 'Receive'}
                      </Btn>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
