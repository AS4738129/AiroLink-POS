import { useState, type FormEvent } from 'react'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { Btn, Logo, inputCls } from '../components/ui'

export default function Onboarding() {
  const { reload } = useAuth()
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const go = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const { error } = await supabase.rpc('create_organization', { p_name: name })
    setBusy(false)
    if (error) setErr(friendly(error))
    else await reload()
  }

  return (
    <main className="auth-bg relative grid min-h-screen place-items-center overflow-hidden p-4">
      <div aria-hidden className="auth-grid pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute -top-28 left-1/2 h-72 w-full max-w-[42rem] -translate-x-1/2 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative w-full max-w-md">
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
          onSubmit={go}
          className="space-y-4 rounded-2xl border border-brand-100 bg-white p-6 shadow-[0_24px_60px_-24px_rgba(7,18,36,0.55)] sm:p-8"
          aria-label="Set up your business"
        >
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink-900">Set up your business</h1>
            <p className="mt-1 text-sm text-slate-600">
              Create your business workspace. You will be the owner — staff can be added later. A main
              branch and a 14-day trial are provisioned automatically.
            </p>
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Business name <span aria-hidden className="text-red-600">*</span>
            <input
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Accra Hardware Ltd"
              aria-label="Business name"
              className={`${inputCls} mt-1 py-2.5`}
            />
          </label>
          {err && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {err}
            </p>
          )}
          <Btn type="submit" variant="primary" disabled={busy || name.trim().length < 2} className="w-full py-2.5">
            {busy ? 'Creating business…' : 'Create business'}
          </Btn>
        </form>
      </div>
    </main>
  )
}
