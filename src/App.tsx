import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useAuth } from './features/auth/AuthProvider'
import { allowed } from './lib/permissions'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Pos from './pages/Pos'
import Products from './pages/Products'
export default function App() {
  const { session, org, loading } = useAuth()
  if (loading) return <p className="p-8">Loading…</p>
  if (!session) return <Login />
  if (!org) return <Onboarding />
  const link = ({ isActive }: { isActive: boolean }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-2 border-b bg-white px-4 py-2">
        <strong className="mr-4">{org.name}</strong>
        {allowed('pos', org.role) && <NavLink to="/pos" className={link}>POS</NavLink>}
        {allowed('products', org.role) && <NavLink to="/products" className={link}>Products</NavLink>}
        <span className="ml-auto text-xs text-gray-500">{org.role.replace('_', ' ')}</span>
        <button onClick={() => void supabase.auth.signOut()} className="rounded-lg border px-3 py-1.5 text-sm">Sign out</button>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        <Routes>
          <Route path="/pos" element={allowed('pos', org.role) ? <Pos /> : <Navigate to="/products" />} />
          <Route path="/products" element={<Products />} />
          <Route path="*" element={<Navigate to={allowed('pos', org.role) ? '/pos' : '/products'} />} />
        </Routes>
      </main>
    </div>
  )
}
