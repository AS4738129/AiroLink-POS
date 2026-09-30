import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

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

// Shared sea-blue page canvas: the visual treatment Dashboard introduced,
// reused by every sidebar menu page so the app has one consistent canvas.
// Content (cards/tables/forms/POS panels) stays on white/light surfaces.
// Negative margins bleed into the shell <main> padding so the theme fills the page.
export const pageCanvasCls =
  '-m-4 space-y-4 bg-gradient-to-b from-ink-900 via-brand-800 to-brand-700 p-4 sm:-m-6 sm:space-y-5 sm:p-6'

// PageHeader rendered on the sea-blue canvas: white title + soft sky description
// for contrast. Business content itself stays on light surfaces.
export function PageHeaderOnDark({
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
        <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">{title}</h1>
        {description && <p className="mt-0.5 max-w-2xl text-sm text-sky-100/85">{description}</p>}
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

// Consistent inline action icons for CRUD tables/dialogs. Decorative only
// (aria-hidden): the adjacent text label stays the accessible name. No icon
// library is introduced; stroke styling matches the existing AppShell icons.
export type CrudIconName =
  | 'add' | 'edit' | 'view' | 'deactivate' | 'activate' | 'delete'
  | 'close' | 'receive' | 'print' | 'refresh' | 'adjust' | 'save' | 'search'
export function CrudIcon({ name, className = 'size-4 shrink-0' }: { name: CrudIconName; className?: string }) {
  const common = { 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24', className } as const
  switch (name) {
    case 'add':
      return (<svg {...common}><path d="M12 5v14M5 12h14" /></svg>)
    case 'edit':
      return (<svg {...common}><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 6.5l3 3" /></svg>)
    case 'view':
      return (<svg {...common}><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.8" /></svg>)
    case 'deactivate':
      return (<svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M8 8l8 8" /></svg>)
    case 'activate':
      return (<svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.5l2.5 2.5 4.5-5.5" /></svg>)
    case 'delete':
      return (<svg {...common}><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" /><path d="M10 11v6M14 11v6" /></svg>)
    case 'close':
      return (<svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>)
    case 'receive':
      return (<svg {...common}><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>)
    case 'print':
      return (<svg {...common}><path d="M7 8V3h10v5" /><rect x="4" y="8" width="16" height="8" rx="2" /><rect x="7" y="13" width="10" height="8" rx="1" /></svg>)
    case 'refresh':
      return (<svg {...common}><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 3v5h-5" /></svg>)
    case 'adjust':
      return (<svg {...common}><path d="M4 8h10M18 8h2M4 16h4M12 16h8" /><circle cx="16" cy="8" r="2" /><circle cx="10" cy="16" r="2" /></svg>)
    case 'save':
      return (<svg {...common}><path d="M5 4h11l3 3v13H5V4z" /><path d="M8 4v5h7V4M8 20v-7h8v7" /></svg>)
    case 'search':
      return (<svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l5 5" /></svg>)
    default:
      return null
  }
}

// Compact, keyboard-accessible table action. Renders as a button with a
// consistent focus ring; `danger` distinguishes destructive/deactivate actions
// visually without changing what the action does.
export function RowAction({
  icon,
  danger,
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: CrudIconName; danger?: boolean }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-600 ${
        danger ? 'text-red-700 hover:bg-red-50 hover:text-red-800' : 'text-brand-700 hover:bg-brand-50 hover:text-brand-800 hover:underline'
      } ${className}`}
      {...rest}
    >
      {icon && <CrudIcon name={icon} />}
      {children}
    </button>
  )
}

// Shared modal shell: overlay click + Escape close, labelled dialog, visible
// close control, responsive width, initial focus on the close button.
export function Dialog({
  label,
  onClose,
  wide,
  children,
}: {
  label: string
  onClose: () => void
  wide?: boolean
  children: ReactNode
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`w-full ${wide ? 'max-w-lg' : 'max-w-sm'} max-h-[90vh] space-y-3 overflow-y-auto rounded-2xl border border-brand-100 bg-white p-5 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 flex-1 text-base font-semibold text-slate-900">{label}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close"
            className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// Consistent pagination footer for CRUD tables.
export function Pager({
  page,
  total,
  pageSize,
  onPrev,
  onNext,
}: {
  page: number
  total: number
  pageSize: number
  onPrev: () => void
  onNext: () => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
      <Btn type="button" disabled={page === 0} onClick={onPrev} aria-label="Previous page">Previous</Btn>
      <span aria-live="polite">Page {page + 1} of {pages}</span>
      <Btn type="button" disabled={(page + 1) * pageSize >= total} onClick={onNext} aria-label="Next page">Next</Btn>
    </div>
  )
}
