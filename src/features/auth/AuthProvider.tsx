import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { Role } from '../../lib/permissions'
export type Org = { id: string; name: string; taxRate: number; currency: string; role: Role }
type Ctx = { session: Session | null; org: Org | null; loading: boolean; reload: () => Promise<void> }
const C = createContext<Ctx>({ session: null, org: null, loading: true, reload: async () => {} })
export const useAuth = () => useContext(C)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [org, setOrg] = useState<Org | null>(null)
  const [loading, setLoading] = useState(true)
  const loadOrg = async (s: Session | null) => {
    if (!s) { setOrg(null); return }
    const { data } = await supabase.from('organization_members').select('role, organizations(id,name,tax_rate,currency)').eq('user_id', s.user.id).limit(1).maybeSingle()
    const o = data as unknown as { role: Role; organizations: { id: string; name: string; tax_rate: number; currency: string } } | null
    setOrg(o ? { id: o.organizations.id, name: o.organizations.name, taxRate: Number(o.organizations.tax_rate), currency: o.organizations.currency, role: o.role } : null)
  }
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => { setSession(data.session); await loadOrg(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); void loadOrg(s) })
    return () => sub.subscription.unsubscribe()
  }, [])
  return <C.Provider value={{ session, org, loading, reload: () => loadOrg(session) }}>{children}</C.Provider>
}
