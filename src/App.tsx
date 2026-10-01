import { useState, type FormEvent, type SVGProps } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase, friendly } from './lib/supabase'
import { useAuth } from './features/auth/AuthProvider'
import { allowed } from './lib/permissions'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Pos from './pages/Pos'
import Products from './pages/Products'
import Inventory from './pages/Inventory'
import Sales from './pages/Sales'
import Customers from './pages/Customers'
import Suppliers from './pages/Suppliers'
import Purchases from './pages/Purchases'
import Expenses from './pages/Expenses'
import Reports from './pages/Reports'
import DataManagement from './pages/DataManagement'
import { ContextCacheSync } from './components/ContextCacheSync'
import { BrandMark, Btn, Field, Notice, Spinner, inputCls } from './components/ui'

// Presentation-only label: the internal role value (e.g. 'owner') never changes,
// and this maps ONLY how it reads in the shell. Permissions/RLS are untouched.
export const roleLabel = (role: string) => (role === 'owner' ? 'Admin' : role.replace('_', ' '))

export default function App() {
  return (
    <>
      <ContextCacheSync />
      <AppShell />
    </>
  )
}

// Lightweight inline SVG icons (decorative; adjacent text is the label). No icon dependency.
type NavIconName = 'dashboard' | 'pos' | 'products' | 'inventory' | 'sales' | 'customers' | 'suppliers' | 'purchases' | 'expenses' | 'reports' | 'data'
function NavIcon({ name, className = 'size-5 shrink-0' }: { name: NavIconName; className?: string }) {
  const common: SVGProps<SVGSVGElement> = { 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24', className }
  switch (name) {
    case 'dashboard':
      return (<svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>)
    case 'pos':
      return (<svg {...common}><circle cx="9" cy="20" r="1.5" /><circle cx="17" cy="20" r="1.5" /><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6" /></svg>)
    case 'products':
      return (<svg {...common}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></svg>)
    case 'inventory':
      return (<svg {...common}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></svg>)
    case 'sales':
      return (<svg {...common}><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" /><path d="M9 8h6M9 12h6" /></svg>)
    case 'customers':
      return (<svg {...common}><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.6c2.9.4 5 2.6 5 5.4" /></svg>)
    case 'suppliers':
      return (<svg {...common}><path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></svg>)
    case 'purchases':
      return (<svg {...common}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4a3 3 0 0 1 6 0M9 11h6M9 15h6" /></svg>)
    case 'expenses':
      return (<svg {...common}><path d="M4 7h16M4 7v12h16V7" /><path d="M4 7l2-3h12l2 3M9 11h6" /></svg>)
    case 'reports':
      return (<svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>)
    case 'data':
      return (<svg {...common}><path d="M12 3c2.8 0 5 1.1 5 2.5S14.8 8 12 8 7 6.9 7 5.5 9.2 3 12 3z" /><path d="M7 5.5v6C7 12.9 9.2 14 12 14s5-1.1 5-2.5v-6" /><path d="M7 11.5v6c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-6" /></svg>)
    default:
      return null
  }
}

const NAV: { to: string; label: string; feature: string; icon: NavIconName }[] = [
  { to: '/dashboard', label: 'Dashboard', feature: 'dashboard', icon: 'dashboard' },
  { to: '/pos', label: 'POS', feature: 'pos', icon: 'pos' },
  { to: '/products', label: 'Products', feature: 'products', icon: 'products' },
  { to: '/inventory', label: 'Inventory', feature: 'inventory', icon: 'inventory' },
  { to: '/sales', label: 'Sales', feature: 'salesHistory', icon: 'sales' },
  { to: '/customers', label: 'Customers', feature: 'customers', icon: 'customers' },
  { to: '/suppliers', label: 'Suppliers', feature: 'suppliers', icon: 'suppliers' },
  { to: '/purchases', label: 'Purchases', feature: 'purchases', icon: 'purchases' },
  { to: '/expenses', label: 'Expenses', feature: 'expenses', icon: 'expenses' },
  { to: '/reports', label: 'Reports', feature: 'reports', icon: 'reports' },
  { to: '/data', label: 'Data', feature: 'dataManagement', icon: 'data' },
]

function navCls({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white ${
    isActive
      ? 'bg-gradient-to-r from-brand-500 to-brand-600 font-semibold text-white shadow-[0_8px_20px_-10px_rgba(28,109,217,0.8)] ring-1 ring-inset ring-white/25'
      : 'text-sky-100/70 hover:bg-white/10 hover:text-white'
  }`
}

function mobileNavCls({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-base font-medium focus-visible:outline-2 focus-visible:outline-brand-600 ${
    isActive
      ? 'bg-gradient-to-r from-brand-500 to-brand-600 font-semibold text-white ring-1 ring-inset ring-white/25'
      : 'text-brand-800 hover:bg-brand-50'
  }`
}

// Frontend-only "Active" marker: the selected organization context is live (the user
// is authenticated into it). No status system, no DB field — presentation only.
function ActiveMark({ dark = false }: { dark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${dark ? 'text-emerald-300' : 'text-emerald-700'}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${dark ? 'bg-emerald-400' : 'bg-emerald-500'}`} />
      Active
    </span>
  )
}

// Utility icons for the top-bar tools (decorative; the button label is the name).
type UtilIconName = 'calculator' | 'calendar' | 'bell'
function UtilIcon({ name, className = 'size-5 shrink-0' }: { name: UtilIconName; className?: string }) {
  const common: SVGProps<SVGSVGElement> = { 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24', className }
  switch (name) {
    case 'calculator':
      return (<svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 15.5h.01M12 15.5h.01M16 15.5h.01M8 19h.01M12 19h.01M16 19h.01" /></svg>)
    case 'calendar':
      return (<svg {...common}><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10.5h16" /><circle cx="12" cy="15.5" r="1.2" /></svg>)
    case 'bell':
      return (<svg {...common}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>)
    default:
      return null
  }
}

// Frontend-only calculator: a cashier scratch-pad. No persistence, no POS/checkout
// interaction — it only computes the digits typed into it.
function CalculatorPad() {
  const [display, setDisplay] = useState('0')
  const [stored, setStored] = useState<number | null>(null)
  const [op, setOp] = useState<string | null>(null)
  const [fresh, setFresh] = useState(true)

  const fmt = (n: number) => {
    if (!Number.isFinite(n)) return 'Error'
    return String(parseFloat(n.toPrecision(12)))
  }
  const compute = (a: number, b: number, o: string): number => {
    switch (o) {
      case '+': return a + b
      case '−': return a - b
      case '×': return a * b
      case '÷': return b === 0 ? NaN : a / b
      default: return b
    }
  }
  const inputDigit = (d: string) => {
    if (display === 'Error' || fresh || display === '0') { setDisplay(d); setFresh(false) }
    else if (display.replace(/[^0-9]/g, '').length < 12) setDisplay(display + d)
  }
  const inputDot = () => {
    if (display === 'Error' || fresh) { setDisplay('0.'); setFresh(false) }
    else if (!display.includes('.')) setDisplay(display + '.')
  }
  const applyOp = (next: string) => {
    if (display === 'Error') return
    const cur = parseFloat(display)
    if (op !== null && stored !== null && !fresh) {
      const r = compute(stored, cur, op)
      setStored(Number.isFinite(r) ? r : null)
      setDisplay(fmt(r))
    } else {
      setStored(cur)
    }
    setOp(next)
    setFresh(true)
  }
  const equals = () => {
    if (op === null || stored === null || display === 'Error') return
    const r = compute(stored, parseFloat(display), op)
    setDisplay(fmt(r))
    setStored(null)
    setOp(null)
    setFresh(true)
  }
  const clear = () => { setDisplay('0'); setStored(null); setOp(null); setFresh(true) }
  const backspace = () => {
    if (fresh || display === 'Error') return
    if (display.length <= 1) setDisplay('0')
    else {
      const next = display.slice(0, -1)
      setDisplay(next === '-' || next === '' ? '0' : next)
    }
  }
  const keys: { label: string; onClick: () => void; span?: boolean; accent?: boolean }[] = [
    { label: 'C', onClick: clear },
    { label: '⌫', onClick: backspace },
    { label: '÷', onClick: () => applyOp('÷') },
    { label: '×', onClick: () => applyOp('×') },
    { label: '7', onClick: () => inputDigit('7') },
    { label: '8', onClick: () => inputDigit('8') },
    { label: '9', onClick: () => inputDigit('9') },
    { label: '−', onClick: () => applyOp('−') },
    { label: '4', onClick: () => inputDigit('4') },
    { label: '5', onClick: () => inputDigit('5') },
    { label: '6', onClick: () => inputDigit('6') },
    { label: '+', onClick: () => applyOp('+') },
    { label: '1', onClick: () => inputDigit('1') },
    { label: '2', onClick: () => inputDigit('2') },
    { label: '3', onClick: () => inputDigit('3') },
    { label: '=', onClick: equals, span: true, accent: true },
    { label: '0', onClick: () => inputDigit('0'), span: true },
    { label: '.', onClick: inputDot },
  ]
  return (
    <div>
      <div aria-live="polite" className="truncate rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-right font-mono text-xl font-bold text-ink-900">
        {op && stored !== null ? `${fmt(stored)} ${op} ` : ''}{display}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {keys.map((k) => (
          <button
            key={k.label + (k.span ? '-span' : '')}
            type="button"
            onClick={k.onClick}
            aria-label={k.label === '⌫' ? 'Delete last digit' : k.label === '=' ? 'Equals' : `Calculator key ${k.label}`}
            className={`rounded-lg px-2 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-brand-600 ${
              k.accent
                ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white hover:from-brand-600 hover:to-brand-700'
                : 'border border-brand-100 bg-white text-slate-800 hover:bg-brand-50'
            } ${k.span ? 'col-span-2' : ''}`}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// Frontend-only month view: view current month, step prev/next, today highlighted.
// No events, no persistence — date context only.
function MonthView() {
  const now = new Date()
  const [y, setY] = useState(now.getFullYear())
  const [m, setM] = useState(now.getMonth())
  const firstDow = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const title = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const isToday = (d: number) => d === now.getDate() && m === now.getMonth() && y === now.getFullYear()
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => { const d = new Date(y, m - 1, 1); setY(d.getFullYear()); setM(d.getMonth()) }} aria-label="Previous month" className="rounded-lg border border-brand-100 px-2.5 py-1 text-sm font-bold text-brand-800 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600">‹</button>
        <p className="text-sm font-bold text-ink-900">{title}</p>
        <button type="button" onClick={() => { const d = new Date(y, m + 1, 1); setY(d.getFullYear()); setM(d.getMonth()) }} aria-label="Next month" className="rounded-lg border border-brand-100 px-2.5 py-1 text-sm font-bold text-brand-800 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600">›</button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500" aria-hidden="true">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => d === null ? (
          <span key={`e${i}`} />
        ) : (
          <span key={d} className={`flex aspect-square items-center justify-center rounded-lg text-sm ${isToday(d) ? 'bg-gradient-to-b from-brand-500 to-brand-600 font-bold text-white' : 'text-slate-700'}`}>
            {d}
          </span>
        ))}
      </div>
    </div>
  )
}

// Notification shell only: there is no notification backend today, so this panel
// intentionally shows an empty state and never invents notification content.
function NotificationPanel() {
  return (
    <div className="py-6 text-center">
      <p className="text-sm font-semibold text-slate-800">No new notifications</p>
      <p className="mx-auto mt-1 max-w-[16rem] text-xs text-slate-500">You&apos;re all caught up. New alerts will appear here when available.</p>
    </div>
  )
}

// Profile editor: full name lives in auth user_metadata (set at sign-up) and is
// mirrored to the public profiles table. Editing here updates BOTH through
// existing mechanisms only: supabase.auth.updateUser (auth) + an update on the
// existing profiles row (RLS prof_upd allows id = auth.uid()). No new tables,
// no migration, no auth-logic change. Email is auth-controlled: read-only.
function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { session, org } = useAuth()
  const meta = session?.user.user_metadata as { full_name?: unknown } | undefined
  const initial = (typeof meta?.full_name === 'string' && meta.full_name.trim()) || ''
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setMsg({ ok: false, t: 'Full name is required.' }); return }
    setBusy(true); setMsg(null)
    try {
      const { error: authErr } = await supabase.auth.updateUser({ data: { full_name: trimmed } })
      if (authErr) throw authErr
      const { error: profErr } = await supabase.from('profiles').update({ full_name: trimmed }).eq('id', session!.user.id)
      if (profErr) throw profErr
      setMsg({ ok: true, t: 'Profile updated.' })
    } catch (err) {
      setMsg({ ok: false, t: friendly(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Edit profile" className="w-full max-w-sm space-y-3 rounded-2xl border border-brand-100 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Your profile</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600">✕</button>
        </div>
        {msg && <Notice tone={msg.ok ? 'ok' : 'err'}>{msg.t}</Notice>}
        <form onSubmit={save} className="space-y-3">
          <Field label="Full name" required>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputCls} />
          </Field>
          <Field label="Email (managed by sign-in, read-only)">
            <input value={session?.user.email ?? ''} readOnly disabled aria-readonly="true" className={`${inputCls} bg-slate-50 text-slate-500`} />
          </Field>
          <dl className="space-y-1 rounded-xl border border-brand-100 bg-brand-50/50 p-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Role</dt><dd className="font-medium capitalize">{roleLabel(org?.role ?? '')}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Business</dt><dd className="max-w-[12rem] truncate font-medium" title={org?.name}>{org?.name ?? '—'}</dd></div>
          </dl>
          <div className="flex justify-end gap-2">
            <Btn type="button" onClick={onClose}>Cancel</Btn>
            <Btn type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

function AppShell() {
  const {
    session, org, branch, branches, switchBranch, orgs, switchOrg,
    subscription, entitled, contextLoading, contextError, loading, reload,
  } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  // Top-bar utility popover: exactly one of calculator / calendar / notifications.
  // All three are frontend-only tools; none touches business data or POS logic.
  const [utilOpen, setUtilOpen] = useState<'calc' | 'cal' | 'notif' | null>(null)
  const toggleUtil = (u: 'calc' | 'cal' | 'notif') => setUtilOpen((cur) => (cur === u ? null : u))
  const utilBtnCls = (active: boolean) =>
    `flex size-8 items-center justify-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-brand-600 ${
      active
        ? 'border-brand-600 bg-brand-600 text-white'
        : 'border-slate-300 bg-white text-slate-600 hover:bg-brand-50 hover:text-brand-700'
    }`

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-mist-100 p-8">
        <Spinner label="Loading AiroLink POS…" />
      </main>
    )
  }
  if (!session) return <Login />
  if (!org) return <Onboarding />

  // While the organization's branches/subscription are loading, do not decide (and redirect) on an unknown entitlement.
  const posAllowed = allowed('pos', org.role) && entitled
  const inventoryAllowed = allowed('inventory', org.role)
  const salesAllowed = allowed('salesHistory', org.role)
  const customersAllowed = allowed('customers', org.role)
  const suppliersAllowed = allowed('suppliers', org.role)
  const purchasesAllowed = allowed('purchases', org.role)
  const expensesAllowed = allowed('expenses', org.role)
  const reportsAllowed = allowed('reports', org.role)
  const items = NAV.filter((n) => allowed(n.feature, org.role))
  // Display-only: prefer the sign-up full name, fall back to the account email. No auth/org logic changes.
  const meta = session.user.user_metadata as { full_name?: unknown } | undefined
  const displayName =
    (typeof meta?.full_name === 'string' && meta.full_name.trim()) || session.user.email || 'Account'
  // Compact top-bar identity shows the first name only ("Simon Adade" -> "Simon").
  // The underlying profile data is unchanged; the dialog still edits the full name.
  const firstName = displayName.split(' ')[0] || displayName

  return (
    <div className="min-h-screen bg-gradient-to-b from-mist-100 via-mist-50 to-mist-100 text-slate-900 lg:flex">
      {/* Sidebar (desktop): fixed to the viewport height; its own nav scrolls
          internally while page content scrolls independently. No JS listeners. */}
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-hidden bg-gradient-to-b from-ink-800 via-ink-900 to-ink-950 lg:flex">
        <div className="flex items-center gap-2 px-4 pb-4 pt-6">
          <BrandMark />
        </div>
        {/* Business identity: registered org name is the visual anchor, stronger than nav labels. */}
        <div className="space-y-0.5 px-4 pb-4">
          <p className="truncate text-lg font-bold tracking-tight text-white" title={org.name}>{org.name}</p>
          <ActiveMark dark />
        </div>
        <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-2">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className={navCls}>
              <NavIcon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        {/* Sidebar footer is context only (no account controls — those live in the top bar). */}
        <div className="space-y-1 border-t border-white/10 p-4 pt-4">
          <p className="truncate text-sm font-bold text-white" title={displayName}>{displayName}</p>
          <p className="text-xs font-normal capitalize text-slate-400">{roleLabel(org.role)}</p>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Top bar: business | branch | POS | user | profile | sign out.
            Official AiroLink branding lives in the sidebar BrandMark; the top bar
            shows only the registered organization name (no duplicate product text). */}
        <header className="no-print sticky top-0 z-10 border-b border-brand-100 bg-white/90 shadow-[0_8px_24px_-16px_rgba(28,109,217,0.35)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5">
            <button
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-600 lg:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label="Toggle navigation menu"
            >
              ☰
            </button>
            {orgs.length > 1 ? (
              <span className="flex min-w-0 max-w-full items-center gap-1.5">
                <select
                  aria-label="Business"
                  value={org.id}
                  onChange={(e) => switchOrg(e.target.value)}
                  className="min-w-0 max-w-[10rem] truncate rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-base font-bold text-ink-900 sm:max-w-[12rem]"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <ActiveMark />
              </span>
            ) : (
              <span className="flex min-w-0 max-w-full items-center gap-1.5">
                <strong className="min-w-0 max-w-[10rem] truncate text-base font-bold text-ink-900 sm:max-w-[14rem] sm:text-lg" title={org.name}>
                  {org.name}
                </strong>
                <ActiveMark />
              </span>
            )}
            {branches.length > 1 && (
              <select
                aria-label="Branch"
                value={branch?.id ?? ''}
                onChange={(e) => switchBranch(e.target.value)}
                className="w-full min-w-0 max-w-full truncate rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 sm:w-auto sm:max-w-[10rem]"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
            {/* Right-side utility group: POS + frontend-only tools. Visually distinct
                from the business context (org/branch) on the left; wraps instead of
                overflowing on narrow screens. */}
            <span className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
            {allowed('pos', org.role) && (
              <Link
                to="/pos"
                className="hidden items-center gap-1.5 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-[0_6px_16px_-8px_rgba(28,109,217,0.7)] transition-colors hover:from-brand-600 hover:to-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600 sm:inline-flex"
              >
                <NavIcon name="pos" className="size-4 shrink-0" />
                POS
              </Link>
            )}
            {/* Frontend-only utilities: calculator / calendar / notifications.
                Icon buttons with labels for a11y; panels open below without navigating. */}
            <span className="flex items-center gap-1.5" role="group" aria-label="Workspace utilities">
              <button
                type="button"
                onClick={() => toggleUtil('calc')}
                aria-expanded={utilOpen === 'calc'}
                aria-label="Open calculator"
                title="Calculator"
                className={utilBtnCls(utilOpen === 'calc')}
              >
                <UtilIcon name="calculator" />
              </button>
              <button
                type="button"
                onClick={() => toggleUtil('cal')}
                aria-expanded={utilOpen === 'cal'}
                aria-label="Open calendar"
                title="Calendar"
                className={utilBtnCls(utilOpen === 'cal')}
              >
                <UtilIcon name="calendar" />
              </button>
              <button
                type="button"
                onClick={() => toggleUtil('notif')}
                aria-expanded={utilOpen === 'notif'}
                aria-label="Open notifications"
                title="Notifications"
                className={utilBtnCls(utilOpen === 'notif')}
              >
                <UtilIcon name="bell" />
              </button>
            </span>
            {/* Desktop user cluster: first name only + Admin label + avatar menu.
                Inside the right-side utility group, so no second ml-auto. */}
            <span className="hidden items-center gap-2 border-l border-brand-100 pl-2 lg:flex" title={displayName}>
              <strong className="max-w-[12rem] truncate text-sm font-extrabold tracking-tight text-ink-900">{firstName}</strong>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold capitalize text-brand-800 ring-1 ring-inset ring-brand-200">{roleLabel(org.role)}</span>
              <span className="relative">
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  aria-expanded={userMenuOpen}
                  aria-label="User menu"
                  className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600"
                  title={displayName}
                >
                  {displayName.charAt(0).toUpperCase()}
                </button>
                {userMenuOpen && (
                  <>
                    <button aria-label="Close user menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setUserMenuOpen(false)} />
                    <span className="absolute right-0 z-20 mt-1 block w-44 rounded-xl border border-brand-100 bg-white py-1 shadow-lg">
                      <button
                        onClick={() => { setUserMenuOpen(false); setProfileOpen(true) }}
                        className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600"
                      >
                        Profile
                      </button>
                      <button
                        onClick={() => void supabase.auth.signOut()}
                        className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600"
                      >
                        Sign out
                      </button>
                    </span>
                  </>
                )}
              </span>
            </span>
            {/* Compact controls (mobile/tablet): profile + sign out stay reachable without overflow.
                Border-l keeps the user area distinct from the utility group. */}
            <span className="flex items-center gap-2 border-l border-brand-100 pl-2 lg:hidden">
              <button
                onClick={() => setProfileOpen(true)}
                aria-label="Edit profile"
                title={displayName}
                className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600"
              >
                {displayName.charAt(0).toUpperCase()}
              </button>
              <button
                onClick={() => void supabase.auth.signOut()}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-600"
              >
                Sign out
              </button>
            </span>
            </span>
          </div>
          {/* Utility panel: one compact popover for calculator / calendar / notifications */}
          {utilOpen && (
            <div className="border-t border-brand-100/60 bg-white px-4 py-3">
              <div className="mx-auto w-full max-w-6xl">
                <div className="ml-auto min-w-0 w-full max-w-xs rounded-xl border border-brand-100 bg-white shadow-lg">
                  <div className="flex items-center justify-between gap-2 border-b border-brand-100/70 px-3 py-2">
                    <p className="text-sm font-bold text-ink-900">
                      {utilOpen === 'calc' ? 'Calculator' : utilOpen === 'cal' ? 'Calendar' : 'Notifications'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setUtilOpen(null)}
                      aria-label="Close panel"
                      className="min-h-[44px] min-w-[44px] rounded-lg px-2 py-0.5 text-sm text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="p-3">
                    {utilOpen === 'calc' ? <CalculatorPad /> : utilOpen === 'cal' ? <MonthView /> : <NotificationPanel />}
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* Mobile nav */}
          {menuOpen && (
            <nav aria-label="Primary" className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto border-t border-brand-100 bg-white px-4 py-2 lg:hidden">
              {items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={() => setMenuOpen(false)}
                  className={mobileNavCls}
                >
                  <NavIcon name={n.icon} />
                  {n.label}
                </NavLink>
              ))}
            </nav>
          )}
          {/* Mobile identity row: org context + role stay readable without overflow */}
          <div className="flex items-center gap-2 border-t border-brand-100/60 px-4 py-1.5 text-xs text-slate-600 lg:hidden">
            <span className="min-w-0 flex-1 truncate" title={displayName}>
              <strong className="font-semibold text-slate-800">{firstName}</strong>
              {' · '}
              <span className="capitalize">{roleLabel(org.role)}</span>
            </span>
            {branch && branches.length > 0 && (
              <span className="shrink-0 truncate text-slate-500" title={branch.name}>{branch.name}</span>
            )}
          </div>
        </header>
        {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}

        {!contextLoading && subscription && !entitled && (
          <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            <div className="mx-auto max-w-6xl">
              {subscription.status === 'trialing'
                ? 'Your trial has ended.'
                : 'This business’s subscription is not active.'}{' '}
              Point-of-sale is disabled until it is renewed.
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 p-4 sm:p-6">
          {contextLoading ? (
            <p className="py-8 text-center"><Spinner label="Loading business…" /></p>
          ) : contextError ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-medium">Could not load this business&apos;s branches/subscription.</p>
              <p className="mt-1 font-mono text-xs">{contextError}</p>
              <button
                onClick={() => void reload()}
                className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium"
              >
                Retry
              </button>
            </div>
          ) : (
            <Routes key={org.id}>
              <Route path="/dashboard" element={<Dashboard key={branch?.id ?? 'none'} />} />
              <Route path="/pos" element={posAllowed ? <Pos key={branch?.id ?? 'none'} /> : <Navigate to="/products" />} />
              <Route path="/products" element={<Products />} />
              <Route
                path="/inventory"
                element={inventoryAllowed ? <Inventory key={branch?.id ?? 'none'} /> : <Navigate to="/products" />}
              />
              <Route path="/sales" element={salesAllowed ? <Sales /> : <Navigate to="/products" />} />
              <Route path="/customers" element={customersAllowed ? <Customers /> : <Navigate to="/products" />} />
              <Route path="/suppliers" element={suppliersAllowed ? <Suppliers /> : <Navigate to="/products" />} />
              <Route path="/purchases" element={purchasesAllowed ? <Purchases /> : <Navigate to="/products" />} />
              <Route path="/expenses" element={expensesAllowed ? <Expenses /> : <Navigate to="/products" />} />
              <Route path="/reports" element={reportsAllowed ? <Reports /> : <Navigate to="/products" />} />
              {/* Data import/export shells the per-dataset permission gates inside;
                  the page itself is visible to every role (see dataManagement). */}
              <Route path="/data" element={<DataManagement />} />
              <Route path="*" element={<Navigate to="/dashboard" />} />
            </Routes>
          )}
        </main>
        <footer className="border-t border-brand-100/70 px-4 py-3 text-center text-xs text-slate-500">
          <p className="font-semibold text-slate-600">AiroLink POS · v1.0.0</p>
          <p>© 2026 AiroLink. All rights reserved.</p>
        </footer>
      </div>
    </div>
  )
}
