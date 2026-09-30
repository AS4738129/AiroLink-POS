import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useAuth } from './features/auth/AuthProvider'
import { allowed } from './lib/permissions'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Pos from './pages/Pos'
import Products from './pages/Products'
import Inventory from './pages/Inventory'
import Sales from './pages/Sales'
import { ContextCacheSync } from './components/ContextCacheSync'
import { BrandMark, Spinner } from './components/ui'

export default function App() {
  return (
    <>
      <ContextCacheSync />
      <AppShell />
    </>
  )
}

const NAV = [
  { to: '/dashboard', label: 'Dashboard', feature: 'dashboard' },
  { to: '/pos', label: 'POS', feature: 'pos' },
  { to: '/products', label: 'Products', feature: 'products' },
  { to: '/inventory', label: 'Inventory', feature: 'inventory' },
  { to: '/sales', label: 'Sales', feature: 'salesHistory' },
] as const

function navCls({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-[0_8px_20px_-10px_rgba(28,109,217,0.8)]'
      : 'text-sky-100/70 hover:bg-white/10 hover:text-white'
  }`
}

function AppShell() {
  const {
    session, org, branch, branches, switchBranch, orgs, switchOrg,
    subscription, entitled, contextLoading, contextError, loading, reload,
  } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

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
  const items = NAV.filter((n) => allowed(n.feature, org.role))
  // Display-only: prefer the sign-up full name, fall back to the account email. No auth/org logic changes.
  const meta = session.user.user_metadata as { full_name?: unknown } | undefined
  const displayName =
    (typeof meta?.full_name === 'string' && meta.full_name.trim()) || session.user.email || 'Account'

  return (
    <div className="min-h-screen bg-gradient-to-b from-mist-100 via-mist-50 to-mist-100 text-slate-900 lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="no-print hidden w-64 shrink-0 flex-col bg-gradient-to-b from-ink-800 via-ink-900 to-ink-950 lg:flex">
        <div className="flex items-center gap-2 px-4 pb-5 pt-6">
          <BrandMark />
        </div>
        <nav aria-label="Primary" className="flex flex-col gap-1 px-3">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className={navCls}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-1.5 border-t border-white/10 p-4 pt-4">
          <p className="truncate text-base font-extrabold tracking-tight text-white" title={org.name}>{org.name}</p>
          <p className="truncate text-sm font-bold text-white" title={displayName}>{displayName}</p>
          <p className="text-xs font-normal capitalize text-slate-400">{org.role.replace('_', ' ')}</p>
          <button
            onClick={() => void supabase.auth.signOut()}
            className="mt-1.5 w-full rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Top bar */}
        <header className="no-print sticky top-0 z-10 border-b border-brand-100 bg-white/90 shadow-[0_8px_24px_-16px_rgba(28,109,217,0.35)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5">
            <button
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium lg:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label="Toggle navigation menu"
            >
              ☰
            </button>
            <span className="lg:hidden">
              <span className="flex items-center gap-2">
                <img src="/airolink-logo.jpeg" alt="AiroLink logo" className="size-7 rounded-md bg-white object-cover" />
                <strong className="text-sm text-ink-900">AiroLink POS</strong>
              </span>
            </span>
            {orgs.length > 1 ? (
              <select
                aria-label="Business"
                value={org.id}
                onChange={(e) => switchOrg(e.target.value)}
                className="max-w-[12rem] truncate rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-bold text-ink-900"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            ) : (
              <strong className="hidden max-w-[14rem] truncate text-base font-extrabold tracking-tight text-ink-900 sm:block" title={org.name}>
                {org.name}
              </strong>
            )}
            {branches.length > 1 && (
              <select
                aria-label="Branch"
                value={branch?.id ?? ''}
                onChange={(e) => switchBranch(e.target.value)}
                className="max-w-[12rem] truncate rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
            <span className="ml-auto hidden items-baseline gap-1.5 sm:flex" title={displayName}>
              <strong className="max-w-[12rem] truncate text-sm font-extrabold tracking-tight text-ink-900">{displayName}</strong>
              <span className="text-xs font-normal capitalize text-slate-500">{org.role.replace('_', ' ')}</span>
            </span>
            <button
              onClick={() => void supabase.auth.signOut()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:hidden"
            >
              Sign out
            </button>
          </div>
          {/* Mobile nav */}
          {menuOpen && (
            <nav aria-label="Primary" className="flex flex-col gap-1 border-t border-brand-100 bg-white px-4 py-2 lg:hidden">
              {items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-2 text-sm font-medium ${
                      isActive ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white' : 'text-brand-800 hover:bg-brand-50'
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
          )}
        </header>

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

        <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
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
              <Route path="*" element={<Navigate to="/dashboard" />} />
            </Routes>
          )}
        </main>
      </div>
    </div>
  )
}
