import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useAuth } from './features/auth/AuthProvider'
import { allowed } from './lib/permissions'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Pos from './pages/Pos'
import Products from './pages/Products'
import Inventory from './pages/Inventory'
import Sales from './pages/Sales'
import { ContextCacheSync } from './components/ContextCacheSync'
export default function App() {
  return <><ContextCacheSync /><AppShell /></>
}

function AppShell() {
  const { session, org, branch, orgs, switchOrg, subscription, entitled, contextLoading, loading } = useAuth()
  if (loading) return <p className="p-8">Loading…</p>
  if (!session) return <Login />
  if (!org) return <Onboarding />
  const link = ({ isActive }: { isActive: boolean }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`
  // While the organization's branches/subscription are loading, do not decide (and redirect) on an unknown entitlement.
  const posAllowed = allowed('pos', org.role) && entitled
  const inventoryAllowed = allowed('inventory', org.role)
  const salesAllowed = allowed('salesHistory', org.role)
  return (
    <div className="min-h-screen">
      <header className="no-print flex flex-wrap items-center gap-2 border-b bg-white px-4 py-2">
        {orgs.length > 1 ? (
          <select aria-label="Business" value={org.id} onChange={(e) => switchOrg(e.target.value)} className="mr-4 rounded-lg border px-2 py-1.5 text-sm font-semibold">
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : (
          <strong className="mr-4">{org.name}</strong>
        )}
        {allowed('pos', org.role) && <NavLink to="/pos" className={link}>POS</NavLink>}
        {allowed('products', org.role) && <NavLink to="/products" className={link}>Products</NavLink>}
        {inventoryAllowed && <NavLink to="/inventory" className={link}>Inventory</NavLink>}
        {salesAllowed && <NavLink to="/sales" className={link}>Sales</NavLink>}
        <span className="ml-auto text-xs text-gray-500">{org.role.replace('_', ' ')}</span>
        <button onClick={() => void supabase.auth.signOut()} className="rounded-lg border px-3 py-1.5 text-sm">Sign out</button>
      </header>
      {!contextLoading && subscription && !entitled && (
        <div role="alert" className="bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {subscription.status === 'trialing' ? 'Your trial has ended.' : 'This business\u2019s subscription is not active.'} Point-of-sale is disabled until it is renewed.
        </div>
      )}
      <main className="mx-auto max-w-6xl p-4">
        {contextLoading ? <p>Loading business…</p> : <Routes key={org.id}>
          <Route path="/pos" element={posAllowed ? <Pos key={branch?.id ?? 'none'} /> : <Navigate to="/products" />} />
          <Route path="/products" element={<Products />} />
          <Route path="/inventory" element={inventoryAllowed ? <Inventory key={branch?.id ?? 'none'} /> : <Navigate to="/products" />} />
          <Route path="/sales" element={salesAllowed ? <Sales /> : <Navigate to="/products" />} />
          <Route path="*" element={<Navigate to={posAllowed ? '/pos' : '/products'} />} />
        </Routes>}
      </main>
    </div>
  )
}
