// Phase 6A — Organization Profile & Business Settings.
//
// Edits ONLY columns that already exist on `organizations`: name, address,
// phone, email, currency, tax_rate, allow_negative_stock. No migration, no RLS
// change, no RPC: the row is read through the existing `org_sel` policy (any
// member) and written through the existing `org_upd` policy (owner /
// super_admin only). The org id always comes from the session context — never
// from the form — so a user cannot widen the update to another business.
// Frontend role gating is cosmetic; RLS is the real enforcement.
import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import {
  validateOrgSettings,
  toOrgPayload,
  type OrgSettingsInput,
} from '../lib/orgSettings'
import {
  Btn,
  Card,
  Field,
  Notice,
  PageHeaderOnDark,
  Spinner,
  inputCls,
  selectCls,
  pageCanvasCls,
} from '../components/ui'

type OrgRow = {
  name: string
  address: string | null
  phone: string | null
  email: string | null
  currency: string
  tax_rate: number | string
  allow_negative_stock: boolean
}

const EMPTY: OrgSettingsInput = {
  name: '',
  address: '',
  phone: '',
  email: '',
  currency: '',
  taxRate: '',
  allowNegativeStock: false,
}

// Currency is free text in the database (default 'GHS'); the dropdown offers
// common codes but still accepts any typed value via the "Other" option.
const COMMON_CURRENCIES = ['GHS', 'USD', 'EUR', 'GBP', 'NGN', 'KES', 'ZAR', 'XOF']

export default function Settings() {
  const { org, reload } = useAuth()
  const qc = useQueryClient()
  const [form, setForm] = useState<OrgSettingsInput>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [customCurrency, setCustomCurrency] = useState(false)

  // Only owner / super_admin may edit (mirrors the org_upd RLS policy).
  // Everyone else gets a read-only view through org_sel.
  const canEdit = org?.role === 'owner' || org?.role === 'super_admin'

  // Key follows the app convention: classified ORG_ONLY root plus org id.
  const row = useQuery({ queryKey: ['org-settings', org!.id], queryFn: async () => {
    const { data, error } = await supabase
      .from('organizations')
      .select('name,address,phone,email,currency,tax_rate,allow_negative_stock')
      .eq('id', org!.id)
      .single()
    if (error) throw error
    return data as unknown as OrgRow
  } })

  // Populate the form once from the persisted row (never clobber edits).
  useEffect(() => {
    if (row.data && !loaded) {
      const r = row.data
      setForm({
        name: r.name ?? '',
        address: r.address ?? '',
        phone: r.phone ?? '',
        email: r.email ?? '',
        currency: r.currency ?? '',
        taxRate: String(r.tax_rate ?? ''),
        allowNegativeStock: Boolean(r.allow_negative_stock),
      })
      setCustomCurrency(
        !!r.currency && !COMMON_CURRENCIES.includes(r.currency),
      )
      setLoaded(true)
    }
  }, [row.data, loaded])

  // Editing a different business reloads its persisted values.
  useEffect(() => {
    setLoaded(false)
    setTouched(false)
    setMsg(null)
  }, [org!.id])

  const errors = validateOrgSettings(form)
  const hasErrors = Object.keys(errors).length > 0
  const currencyValue = customCurrency ? 'OTHER' : form.currency

  const set = <K extends keyof OrgSettingsInput>(k: K, v: OrgSettingsInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setTouched(true)
    setMsg(null)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEdit || busy) return
    setTouched(true)
    if (hasErrors) return
    setBusy(true)
    setMsg(null)
    try {
      const { error } = await supabase
        .from('organizations')
        .update(toOrgPayload(form))
        .eq('id', org!.id)
      if (error) throw error
      await qc.invalidateQueries({ queryKey: ['org-settings', org!.id] })
      await reload() // refresh name / currency / tax rate in the shell context
      setMsg({ ok: true, t: 'Business settings saved.' })
    } catch (err) {
      setMsg({ ok: false, t: friendly(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={pageCanvasCls}>
      <PageHeaderOnDark
        title="Business Settings"
        description="Organization profile and business rules for this business."
      />
      {row.isPending ? (
        <p className="py-8 text-center">
          <Spinner label="Loading business settings…" />
        </p>
      ) : row.isError ? (
        <Notice tone="err">
          Could not load business settings:{' '}
          {friendly(row.error)}
        </Notice>
      ) : (
        <Card className="mx-auto w-full max-w-2xl p-4 sm:p-6">
          {!canEdit && (
            <div className="mb-3">
              <Notice tone="info">
                You can view these settings, but only an owner or
                super_admin can change them.
              </Notice>
            </div>
          )}
          {msg && (
            <div className="mb-3">
              <Notice tone={msg.ok ? 'ok' : 'err'}>{msg.t}</Notice>
            </div>
          )}
          <form onSubmit={save} className="space-y-4" noValidate>
            <Field label="Business name" required error={touched ? errors.name : undefined}>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                disabled={!canEdit}
                autoComplete="organization"
                maxLength={120}
                className={inputCls}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone">
                <input
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  disabled={!canEdit}
                  autoComplete="tel"
                  maxLength={40}
                  placeholder="e.g. +233 20 000 0000"
                  className={inputCls}
                />
              </Field>
              <Field label="Email" error={touched ? errors.email : undefined}>
                <input
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  disabled={!canEdit}
                  autoComplete="email"
                  inputMode="email"
                  maxLength={120}
                  placeholder="e.g. info@example.com"
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label="Address">
              <textarea
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                disabled={!canEdit}
                autoComplete="street-address"
                rows={2}
                maxLength={300}
                className={`${inputCls} min-h-[4.5rem] resize-y`}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency" required error={touched ? errors.currency : undefined}>
                {customCurrency ? (
                  <span className="flex gap-2">
                    <input
                      value={form.currency}
                      onChange={(e) => set('currency', e.target.value.toUpperCase())}
                      disabled={!canEdit}
                      maxLength={10}
                      aria-label="Currency code"
                      placeholder="e.g. GHS"
                      className={inputCls}
                    />
                    <Btn
                      type="button"
                      disabled={!canEdit}
                      onClick={() => {
                        set('currency', 'GHS')
                        setCustomCurrency(false)
                      }}
                    >
                      List
                    </Btn>
                  </span>
                ) : (
                  <select
                    aria-label="Currency"
                    value={currencyValue}
                    onChange={(e) => {
                      if (e.target.value === 'OTHER') {
                        setCustomCurrency(true)
                        set('currency', '')
                      } else {
                        set('currency', e.target.value)
                      }
                    }}
                    disabled={!canEdit}
                    className={selectCls}
                  >
                    {COMMON_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value="OTHER">Other…</option>
                  </select>
                )}
              </Field>
              <Field label="Tax rate (%)" required error={touched ? errors.taxRate : undefined}>
                <input
                  value={form.taxRate}
                  onChange={(e) => set('taxRate', e.target.value)}
                  disabled={!canEdit}
                  inputMode="decimal"
                  maxLength={6}
                  placeholder="e.g. 3"
                  className={inputCls}
                />
              </Field>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-brand-100 bg-brand-50/50 p-3">
              <input
                type="checkbox"
                checked={form.allowNegativeStock}
                onChange={(e) => set('allowNegativeStock', e.target.checked)}
                disabled={!canEdit}
                className="mt-1 size-4 shrink-0 accent-brand-600"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Allow negative stock
                </span>
                <span className="block text-xs text-slate-500">
                  When off, sales and adjustments that would drive stock
                  below zero are rejected. When on, they are allowed.
                </span>
              </span>
            </label>
            {canEdit && (
              <div className="flex justify-end gap-2">
                <Btn type="submit" variant="primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save settings'}
                </Btn>
              </div>
            )}
          </form>
        </Card>
      )}
    </div>
  )
}
