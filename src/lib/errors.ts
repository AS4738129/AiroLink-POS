// Technical detail of a Supabase/PostgREST error (message + code + hint), for showing NEXT to the friendly text so a
// genuine backend/schema problem is visible instead of hidden behind a generic "could not load".
export function errorDetail(e: unknown): string {
  if (!e) return ''
  const x = e as { message?: string; code?: string; hint?: string; details?: string }
  const msg = x.message ?? (typeof e === 'string' ? e : '')
  return [msg, x.code ? `(${x.code})` : '', x.hint ? `Hint: ${x.hint}` : ''].filter(Boolean).join(' ').trim()
}
