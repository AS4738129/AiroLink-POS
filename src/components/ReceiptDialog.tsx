import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../features/auth/AuthProvider'
import { loadReceipt } from '../features/sales/receiptData'
import { ReceiptView } from './Receipt'
import { Btn, CrudIcon, Spinner } from './ui'

// Reprinting re-reads the ORIGINAL stored sale; it never creates or edits one.
export function ReceiptDialog({ receiptNo, saleId, change, onClose }: { receiptNo?: string; saleId?: string; change?: number; onClose: () => void }) {
  const { org } = useAuth()
  const q = useQuery({ queryKey: ['sale', org!.id, saleId ?? receiptNo], queryFn: () => loadReceipt(org!.id, org!.name, org!.currency, { id: saleId, receiptNo }) })
  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-3 rounded-2xl bg-slate-100 p-4 shadow-xl min-w-0"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Receipt"
      >
        {/* Keep the dialog labelled when the receipt itself hasn't loaded yet. */}
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-sm font-semibold text-slate-700" aria-live="polite">
            {q.data ? `Receipt ${q.data.receiptNo}` : 'Receipt'}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close receipt"
            title="Close"
            className="rounded-lg px-2 py-1 text-lg leading-none text-slate-500 transition-colors hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            ✕
          </button>
        </div>
        {q.isLoading && <p className="rounded-xl bg-white p-6 text-center"><Spinner label="Loading receipt…" /></p>}
        {q.isError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Could not load this receipt.{' '}
            <button className="font-medium underline focus-visible:outline-2 focus-visible:outline-brand-600" onClick={() => q.refetch()}>Retry</button>
          </div>
        )}
        {q.data && <ReceiptView r={{ ...q.data, change }} />}
        <div className="no-print flex flex-wrap justify-end gap-2">
          <Btn onClick={onClose} className="bg-white"><CrudIcon name="close" /> Close</Btn>
          <Btn variant="primary" disabled={!q.data} onClick={() => window.print()}><CrudIcon name="print" /> Print</Btn>
        </div>
      </div>
    </div>
  )
}
