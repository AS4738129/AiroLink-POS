import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, friendly } from '../lib/supabase'
import { errorDetail } from '../lib/errors'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
import { METHODS } from '../lib/payments'
import { ReceiptDialog } from '../components/ReceiptDialog'
import {
  Btn, EmptyState, Notice, PageHeader, Spinner, StatusBadge,
  TableShell, rowCls, selectCls, tdCls, thCls, inputCls, filterBarCls,
} from '../components/ui'

const PAGE = 20
type Row = { id: string; receipt_no: string; created_at: string; status: string; total: number; balance_due: number; branch_id: string; cashier_id: string | null; customers: { name: string } | null }
const payStatus = (r: Row) => r.status === 'void' ? 'Void' : Number(r.balance_due) > 0 ? 'Credit (owing)' : 'Paid'
const payTone = (r: Row): 'red' | 'amber' | 'green' => r.status === 'void' ? 'red' : Number(r.balance_due) > 0 ? 'amber' : 'green'

export default function Sales() {
  const { org, branches } = useAuth(); const qc = useQueryClient()
  const [page, setPage] = useState(0); const [receiptQ, setReceiptQ] = useState('')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [branchId, setBranchId] = useState(''); const [customerId, setCustomerId] = useState(''); const [method, setMethod] = useState(''); const [status, setStatus] = useState('')
  const [open, setOpen] = useState<Row | null>(null); const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null)
  const canVoid = allowed('voidSales', org?.role)
  const reset = () => setPage(0)
  // Reset to the first results page whenever the organization changes so the old org's page/filters never linger.
  useEffect(() => { setPage(0); setReceiptQ(''); setFrom(''); setTo(''); setBranchId(''); setCustomerId(''); setMethod(''); setStatus(''); setOpen(null); setNote(null) }, [org!.id])

  const customers = useQuery({ queryKey: ['customers', org!.id], queryFn: async () => { const { data, error } = await supabase.from('customers').select('id,name').eq('org_id', org!.id).order('name').limit(200); if (error) throw error; return data ?? [] } })
  // RLS already limits rows to the branches this user may see; the branch filter only narrows further.
  const list = useQuery({ queryKey: ['sales', org!.id, branchId, page, receiptQ, from, to, customerId, method, status], queryFn: async () => {
    let s = supabase.from('sales').select(`id,receipt_no,created_at,status,total,balance_due,branch_id,cashier_id,customers(name)${method ? ',payments!inner(method)' : ''}`, { count: 'exact' }).eq('org_id', org!.id)
    if (branchId) s = s.eq('branch_id', branchId)
    if (receiptQ.trim()) s = s.ilike('receipt_no', `%${receiptQ.trim().replace(/[,()%]/g, '')}%`)
    if (from) s = s.gte('created_at', new Date(`${from}T00:00:00`).toISOString())
    if (to) s = s.lt('created_at', new Date(new Date(`${to}T00:00:00`).getTime() + 86400000).toISOString())
    if (customerId) s = s.eq('customer_id', customerId)
    if (method) s = s.eq('payments.method', method)
    if (status) s = s.eq('status', status)
    const { data, error, count } = await s.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1); if (error) throw error
    const rows = (data ?? []) as unknown as Row[]
    const ids = [...new Set(rows.map((r) => r.cashier_id).filter((x): x is string => !!x))]
    const names = new Map<string, string>()
    if (ids.length) { const { data: ps } = await supabase.from('profiles').select('id,full_name').in('id', ids); (ps ?? []).forEach((p) => names.set(p.id as string, (p.full_name as string) ?? '')) }
    return { rows, count: count ?? 0, names }
  } })
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '—'

  const voidSale = useMutation({
    mutationFn: async (r: Row) => { const { error } = await supabase.rpc('void_sale', { p_org: org!.id, p_sale: r.id, p_reason: null }); if (error) throw error },
    onSuccess: () => { setNote({ ok: true, t: 'Sale voided. Its stock was restored and any credit reversed. Any cash/mobile-money refund to the customer must be handled manually.' }); setOpen(null)
      void qc.invalidateQueries({ queryKey: ['sales'] }); void qc.invalidateQueries({ queryKey: ['sale'] }); void qc.invalidateQueries({ queryKey: ['branch_inventory'] }); void qc.invalidateQueries({ queryKey: ['pos-stock'] }); void qc.invalidateQueries({ queryKey: ['inv-history'] }) },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })

  return (
    <div className="space-y-4">
      <PageHeader title="Sales" description="Sale history, reprints and voids." />
      {note && <Notice tone={note.ok ? 'ok' : 'err'}>{note.t}</Notice>}
      <div className={filterBarCls}>
        <input value={receiptQ} onChange={(e) => { setReceiptQ(e.target.value); reset() }} placeholder="Receipt number" aria-label="Receipt number" className={`${inputCls} sm:max-w-[12rem]`} />
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset() }} aria-label="From date" className={selectCls} />
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset() }} aria-label="To date" className={selectCls} />
        {branches.length > 1 && <select value={branchId} onChange={(e) => { setBranchId(e.target.value); reset() }} aria-label="Branch filter" className={selectCls}><option value="">All my branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); reset() }} aria-label="Customer filter" className={selectCls}><option value="">All customers</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={method} onChange={(e) => { setMethod(e.target.value); reset() }} aria-label="Payment method filter" className={selectCls}><option value="">Any payment method</option>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); reset() }} aria-label="Status filter" className={selectCls}><option value="">Any status</option><option value="completed">Completed</option><option value="void">Void</option></select>
      </div>
      <TableShell label="Sales">
        <thead>
          <tr>
            {['Receipt #', 'Date', 'Branch', 'Cashier', 'Customer', 'Total', 'Payment', ''].map((h) => (
              <th key={h} className={thCls}>{h === '' ? <span className="sr-only">Actions</span> : h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.isLoading && <tr><td className="p-4" colSpan={8}><Spinner label="Loading sales…" /></td></tr>}
          {list.isError && (
            <tr><td className="p-4 text-red-700" colSpan={8}>
              Could not load sales.<br />
              <span className="font-mono text-xs">{errorDetail(list.error)}</span>{' '}
              <button className="font-medium underline" onClick={() => list.refetch()}>Retry</button>
            </td></tr>
          )}
          {list.data && list.data.rows.length === 0 && (
            <tr><td colSpan={8}><EmptyState title="No sales match." hint="Try widening the date range or clearing the filters." /></td></tr>
          )}
          {list.data?.rows.map((r) => (
            <tr key={r.id} className={`${rowCls} ${r.status === 'void' ? 'text-slate-500' : ''}`}>
              <td className={`${tdCls} font-mono text-xs`}>{r.receipt_no}</td>
              <td className={`${tdCls} whitespace-nowrap`}>{new Date(r.created_at).toLocaleString()}</td>
              <td className={tdCls}>{branchName(r.branch_id)}</td>
              <td className={tdCls}>{(r.cashier_id && list.data?.names.get(r.cashier_id)) || '—'}</td>
              <td className={tdCls}>{r.customers?.name ?? 'Walk-in'}</td>
              <td className={`${tdCls} whitespace-nowrap font-medium`}>{org!.currency} {Number(r.total).toFixed(2)}</td>
              <td className={tdCls}><StatusBadge tone={payTone(r)}>{payStatus(r)}</StatusBadge></td>
              <td className={tdCls}><button className="font-medium text-brand-700 hover:underline" onClick={() => setOpen(r)}>View / reprint</button></td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <Btn disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Btn>
        <span>Page {page + 1} of {Math.max(1, Math.ceil((list.data?.count ?? 0) / PAGE))}</span>
        <Btn disabled={(page + 1) * PAGE >= (list.data?.count ?? 0)} onClick={() => setPage(page + 1)}>Next</Btn>
      </div>
      {open && (
        <div>
          <ReceiptDialog saleId={open.id} onClose={() => setOpen(null)} />
          {canVoid && open.status === 'completed' && (
            <div className="no-print fixed bottom-4 left-1/2 z-20 -translate-x-1/2">
              <Btn
                variant="danger"
                disabled={voidSale.isPending}
                onClick={() => { if (confirm(`Void receipt ${open.receipt_no}? Stock is restored and any credit reversed. This cannot be undone.`)) voidSale.mutate(open) }}
                className="shadow-lg"
              >
                {voidSale.isPending ? 'Voiding…' : `Void ${open.receipt_no}`}
              </Btn>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
