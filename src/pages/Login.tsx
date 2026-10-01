import { useState, type FormEvent } from 'react'
import { supabase, friendly } from '../lib/supabase'
import { Btn, Logo, inputCls } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : mode === 'up'
          ? await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
          : await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setBusy(false)
    if (res.error) {
      setMsg({
        ok: false,
        t: /Invalid login/i.test(res.error.message) ? 'Wrong email or password.' : friendly(res.error),
      })
    } else if (mode === 'up') {
      setMsg({ ok: true, t: 'Account created. Check your email to confirm it, then sign in.' })
    } else if (mode === 'reset') {
      setMsg({ ok: true, t: 'If that email has an account, a reset link is on its way.' })
    }
  }

  const title = mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Reset password'

  return (
    <main className="auth-bg relative grid min-h-screen place-items-center overflow-hidden p-4">
      <div aria-hidden className="auth-grid pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute -top-28 left-1/2 h-72 w-full max-w-[42rem] -translate-x-1/2 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size={72} />
          <div>
            <p className="text-xl font-bold tracking-tight text-white">AiroLink POS</p>
            <p className="text-xs font-medium tracking-widest text-sky-200/70 uppercase">
              Advanced Elevated Technology
            </p>
          </div>
        </div>
        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl border border-brand-100 bg-white p-6 shadow-[0_24px_60px_-24px_rgba(7,18,36,0.55)] sm:p-7"
          aria-label={title}
        >
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink-900">{title}</h1>
            <p className="mt-0.5 text-sm text-slate-500">Secure access to your business workspace.</p>
          </div>
          {mode === 'up' && (
            <label className="block text-sm font-medium text-slate-700">
              Full name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className={`${inputCls} mt-1`}
              />
            </label>
          )}
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputCls} mt-1`}
            />
          </label>
          {mode !== 'reset' && (
            <label className="block text-sm font-medium text-slate-700">
              Password
              <span className="relative mt-1 block font-normal">
                <input
                  required
                  minLength={8}
                  type={showPw ? 'text' : 'password'}
                  autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputCls} pr-16`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-2 px-2 text-xs font-semibold text-brand-700 hover:underline"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </span>
            </label>
          )}
          {msg && (
            <p
              role="status"
              className={`rounded-lg border p-3 text-sm ${
                msg.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {msg.t}
            </p>
          )}
          <Btn type="submit" variant="primary" disabled={busy} className="w-full py-2.5">
            {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}
          </Btn>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'in' ? 'up' : 'in')
                setMsg(null)
              }}
              className="font-medium text-brand-700 hover:underline"
            >
              {mode === 'in' ? 'Create account' : 'Back to sign in'}
            </button>
            {mode === 'in' && (
              <button
                type="button"
                onClick={() => {
                  setMode('reset')
                  setMsg(null)
                }}
                className="font-medium text-brand-700 hover:underline"
              >
                Forgot password?
              </button>
            )}
          </div>
        </form>
        <p className="mt-4 text-center text-xs text-sky-200/70">
          AiroLink IT &amp; Security Services Consultancy
        </p>
      </div>
    </main>
  )
}
