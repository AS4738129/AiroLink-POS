import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../features/auth/AuthProvider'
import { loadReceipt } from '../features/sales/receiptData'
import { ReceiptView } from './Receipt'
import { Btn, Spinner } from './ui'

// Reprinting re-reads the ORIGINAL stored sale; it never creates or edits one.
export function ReceiptDialog({ receiptNo, saleId, change, onClose }: { receiptNo?: string; saleId?: string; change?: number; onClose: () => void }) {
  const { org } = useAuth()
  const q = useQuery({ queryKey: ['sale', org!.id, saleId ?? receiptNo], queryFn: () => loadReceipt(org!.id, org!.name, org!.currency, { id: saleId, receiptNo }) })
  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-3 rounded-2xl bg-slate-100 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Receipt"
      >
        {q.isLoading && <p className="rounded-xl bg-white p-6 text-center"><Spinner label="Loading receipt…" /></p>}
        {q.isError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Could not load this receipt.{' '}
            <button className="font-medium underline" onClick={() => q.refetch()}>Retry</button>
          </div>
        )}
        {q.data && <ReceiptView r={{ ...q.data, change }} />}
        <div className="no-print flex justify-end gap-2">
          <Btn onClick={onClose} className="bg-white">Close</Btn>
          <Btn variant="primary" disabled={!q.data} onClick={() => window.print()}>Print</Btn>
        </div>
      </div>
    </div>
  )
}
