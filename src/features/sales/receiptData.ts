import { supabase } from '../../lib/supabase'
import type { ReceiptData } from '../../components/Receipt'

type SaleRow = {
  id: string; receipt_no: string; status: string; created_at: string; cashier_id: string | null; customer_id: string | null; branch_id: string
  subtotal: number; discount_total: number; tax_total: number; total: number; amount_paid: number; balance_due: number
}
// Loads a stored sale for display/reprint. Everything is read under RLS (org + branch
// authorization), so a user can only ever see sales they are allowed to see.
export async function loadReceipt(orgId: string, business: string, currency: string, by: { id?: string; receiptNo?: string }): Promise<ReceiptData & { saleId: string }> {
  let q = supabase.from('sales').select('id,receipt_no,status,created_at,cashier_id,customer_id,branch_id,subtotal,discount_total,tax_total,total,amount_paid,balance_due').eq('org_id', orgId)
  q = by.id ? q.eq('id', by.id) : q.eq('receipt_no', by.receiptNo ?? '')
  const { data: s, error } = await q.maybeSingle()
  if (error) throw error
  if (!s) throw new Error('Sale not found')
  const sale = s as SaleRow
  const [items, pays, branch, cust, cashier] = await Promise.all([
    supabase.from('sale_items').select('name,qty,unit_price,line_total').eq('sale_id', sale.id).order('name'),
    supabase.from('payments').select('method,amount').eq('sale_id', sale.id).order('created_at'),
    supabase.from('branches').select('name').eq('id', sale.branch_id).maybeSingle(),
    sale.customer_id ? supabase.from('customers').select('name').eq('id', sale.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    sale.cashier_id ? supabase.from('profiles').select('full_name').eq('id', sale.cashier_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  return {
    saleId: sale.id, business, currency, branch: branch.data?.name ?? '—', receiptNo: sale.receipt_no, createdAt: sale.created_at, status: sale.status,
    cashier: (cashier.data as { full_name: string | null } | null)?.full_name ?? null, customer: (cust.data as { name: string } | null)?.name ?? null,
    items: (items.data ?? []) as ReceiptData['items'], payments: (pays.data ?? []) as ReceiptData['payments'],
    subtotal: Number(sale.subtotal), discount: Number(sale.discount_total), tax: Number(sale.tax_total), total: Number(sale.total), paid: Number(sale.amount_paid), due: Number(sale.balance_due),
  }
}
