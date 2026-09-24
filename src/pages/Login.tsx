import { useState, type FormEvent } from 'react'
import { supabase, friendly } from '../lib/supabase'
export default function Login() {
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in')
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null); const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    const res = mode === 'in' ? await supabase.auth.signInWithPassword({ email, password })
      : mode === 'up' ? await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
      : await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setBusy(false)
    if (res.error) setMsg({ ok: false, t: /Invalid login/i.test(res.error.message) ? 'Wrong email or password.' : friendly(res.error) })
    else if (mode === 'up') setMsg({ ok: true, t: 'Account created. Check your email to confirm it, then sign in.' })
    else if (mode === 'reset') setMsg({ ok: true, t: 'If that email has an account, a reset link is on its way.' })
  }
  const inp = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5'
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">AiroLink POS</h1>
        {mode === 'up' && <label className="block text-sm">Full name<input required value={name} onChange={(e) => setName(e.target.value)} className={inp} /></label>}
        <label className="block text-sm">Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inp} /></label>
        {mode !== 'reset' && <label className="block text-sm">Password<input required minLength={8} type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} className={inp} /></label>}
        {msg && <p role="status" className={`rounded-lg p-3 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.t}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium text-white disabled:opacity-60">{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
        <div className="flex justify-between text-sm text-indigo-700">
          <button type="button" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'Create account' : 'Back to sign in'}</button>
          {mode === 'in' && <button type="button" onClick={() => setMode('reset')}>Forgot password?</button>}
        </div>
      </form>
    </main>
  )
}
