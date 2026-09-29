import type { ButtonHTMLAttributes, ReactNode } from 'react'

export const LOGO_SRC = '/airolink-logo.jpeg'

export function Logo({ size = 36, rounded = true }: { size?: number; rounded?: boolean }) {
  return (
    <img
      src={LOGO_SRC}
      alt="AiroLink logo"
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'cover' }}
      className={rounded ? 'rounded-lg bg-white object-cover' : 'bg-white object-cover'}
      loading="lazy"
    />
  )
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Logo size={compact ? 32 : 38} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[15px] font-bold tracking-tight text-white">AiroLink POS</span>
        {!compact && (
          <span className="block truncate text-[11px] font-medium tracking-wide text-sky-200/80">
            Advanced Elevated Technology
          </span>
        )}
      </span>
    </span>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-0.5 max-w-2xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-brand-100 bg-white shadow-[0_1px_2px_rgba(11,37,69,0.05),0_8px_24px_-12px_rgba(28,109,217,0.18)] ${className}`}>{children}</div>
  )
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export function Btn({
  variant = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50'
  const styles: Record<BtnVariant, string> = {
    primary: 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-[0_6px_16px_-8px_rgba(28,109,217,0.7)] hover:from-brand-600 hover:to-brand-700 active:from-brand-700 active:to-brand-700',
    secondary: 'border border-brand-100 bg-white text-brand-800 shadow-sm hover:bg-brand-50 active:bg-brand-100',
    danger: 'bg-red-700 text-white hover:bg-red-800 active:bg-red-800',
    ghost: 'text-brand-700 hover:bg-brand-50 active:bg-brand-100',
  }
  return <button className={`${base} ${styles[variant]} ${className}`} {...rest} />
}

export const inputCls =
  'w-full rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors hover:border-brand-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100'
export const selectCls =
  'rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors hover:border-brand-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100'
export const labelCls = 'block text-sm font-medium text-slate-700'

export function Field({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  children: ReactNode
}) {
  return (
    <label className={labelCls}>
      <span>
        {label} {required && <span aria-hidden className="text-red-600">*</span>}
      </span>
      <span className="mt-1 block font-normal">{children}</span>
      {error && (
        <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
          {error}
        </span>
      )}
    </label>
  )
}

export function StatusBadge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'slate' | 'blue'; children: ReactNode }) {
  const styles: Record<string, string> = {
    green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    red: 'bg-red-50 text-red-800 ring-red-200',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    blue: 'bg-brand-50 text-brand-700 ring-brand-200',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${styles[tone]}`}
    >
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
      />
      {label}
    </span>
  )
}

export function Notice({ tone, children }: { tone: 'ok' | 'err' | 'warn' | 'info'; children: ReactNode }) {
  const styles: Record<string, string> = {
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    err: 'border-red-200 bg-red-50 text-red-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-brand-200 bg-brand-50 text-brand-900',
  }
  return (
    <p role={tone === 'err' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${styles[tone]}`}>
      {children}
    </p>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}
    </div>
  )
}

export function TableShell({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="scroll-slim overflow-x-auto rounded-xl border border-brand-100 bg-white shadow-[0_1px_2px_rgba(11,37,69,0.05),0_8px_24px_-12px_rgba(28,109,217,0.18)]">
      <table className="w-full min-w-[640px] text-left text-sm" aria-label={label}>
        {children}
      </table>
    </div>
  )
}

export const thCls = 'whitespace-nowrap bg-brand-50/60 p-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-800'
export const tdCls = 'p-3 align-middle text-slate-800'
export const rowCls = 'border-t border-brand-100/70 hover:bg-brand-50/50'
export const filterBarCls = 'flex flex-wrap gap-2 rounded-xl border border-brand-100 bg-white p-3 shadow-[0_1px_2px_rgba(11,37,69,0.05),0_8px_24px_-12px_rgba(28,109,217,0.18)]'
