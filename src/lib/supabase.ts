import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.')
export const supabase = createClient(url, key)
// Turn database errors into messages a cashier can act on (no internals leaked).
export const friendly = (e: unknown) => {
  const m = (e as { message?: string })?.message ?? ''
  if (/fetch|network/i.test(m)) return 'Cannot reach the server. Check your internet connection and try again.'
  if (/row-level security|permission denied|Not authorized/i.test(m)) return 'You do not have permission to do that.'
  if (/duplicate key/i.test(m)) return 'That SKU or barcode already exists.'
  if (/Insufficient stock|Credit limit|Cart is empty|Payments exceed|Choose a customer|Product unavailable|Discount exceeds|Invalid/.test(m)) return m
  return 'Something went wrong. Please try again.'
}
