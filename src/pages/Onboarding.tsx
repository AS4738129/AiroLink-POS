import { useState, type FormEvent } from 'react'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
export default function Onboarding() {
  const { reload } = useAuth(); const [name, setName] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const go = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.rpc('create_organization', { p_name: name }); setBusy(false)
    if (error) setErr(friendly(error)); else await reload() }
  return <main className="grid min-h-screen place-items-center p-4"><form onSubmit={go} className="w-full max-w-sm space-y-4 rounded-2xl border bg-white p-6">
    <h1 className="text-2xl font-semibold">Set up your business</h1><p className="text-sm text-gray-600">You will be the owner. Staff can be added later.</p>
    <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name" aria-label="Business name" className="w-full rounded-lg border px-3 py-2.5" />
    {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
    <button disabled={busy} className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium text-white disabled:opacity-60">Create business</button></form></main>
}
