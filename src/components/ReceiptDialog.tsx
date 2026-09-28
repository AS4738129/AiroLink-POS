import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../features/auth/AuthProvider'
import { loadReceipt } from '../features/sales/receiptData'
import { ReceiptView } from './Receipt'

// Reprinting re-reads the ORIGINAL stored sale; it never creates or edits one.
export function ReceiptDialog({ receiptNo, saleId, change, onClose }: { receiptNo?: string; saleId?: string; change?: number; onClose: () => void }) {
  const { org } = useAuth()
  const q = useQuery({ queryKey: ['sale', org!.id, saleId ?? receiptNo], queryFn: () => loadReceipt(org!.id, org!.name, org!.currency, { id: saleId, receiptNo }) })
  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl bg-gray-50 p-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Receipt">
        {q.isLoading && <p className="text-sm">Loading receipt…</p>}
        {q.isError && <p className="text-sm text-red-700">Could not load this receipt.</p>}
        {q.data && <ReceiptView r={{ ...q.data, change }} />}
        <div className="no-print flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border bg-white px-4 py-2">Close</button>
          <button disabled={!q.data} onClick={() => window.print()} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">Print</button>
        </div>
      </div>
    </div>
  )
}
