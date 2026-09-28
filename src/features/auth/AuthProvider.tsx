import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { Role } from '../../lib/permissions'
import { chooseBranch, deriveOrgContext, selectBranch, type OrgContext as GenericOrgContext } from '../../lib/orgContext'

export type Org = { id: string; name: string; taxRate: number; currency: string; role: Role }
export type Branch = { id: string; name: string; isMain: boolean }
export type SubscriptionStatus = 'pending' | 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'suspended'
export type Subscription = { status: SubscriptionStatus; trialEndsAt: string | null; currentPeriodEnd: string | null }

type Ctx = {
  session: Session | null
  // Current organization context (unchanged shape so existing pages keep working).
  org: Org | null
  orgs: Org[]
  switchOrg: (orgId: string) => void
  // Branch context, foundational for now — most pages don't need it yet.
  branch: Branch | null
  branches: Branch[]
  switchBranch: (branchId: string) => void
  // Subscription/entitlement. The database is the real gate (see is_org_entitled
  // and complete_sale); this is only used for frontend UX (banners, disabling
  // protected actions before the round-trip to the server).
  subscription: Subscription | null
  entitled: boolean
  // True while an organization is selected but its branches/subscription have not loaded yet
  // (never expose the previous organization's branch or subscription in that window).
  contextLoading: boolean
  loading: boolean
  reload: () => Promise<void>
}

const C = createContext<Ctx>({
  session: null, org: null, orgs: [], switchOrg: () => {},
  branch: null, branches: [], switchBranch: () => {},
  subscription: null, entitled: false, contextLoading: false, loading: true, reload: async () => {},
})
export const useAuth = () => useContext(C)

const CURRENT_ORG_KEY = 'airolink.currentOrgId'
const CURRENT_BRANCH_KEY = 'airolink.currentBranchId'

function isEntitled(sub: Subscription | null): boolean {
  if (!sub) return false
  if (sub.status === 'active') return !sub.currentPeriodEnd || new Date(sub.currentPeriodEnd) > new Date()
  if (sub.status === 'trialing') return !sub.trialEndsAt || new Date(sub.trialEndsAt) > new Date()
  return false
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [orgs, setOrgs] = useState<Org[]>([])
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null)
  // Branches, current branch and subscription are stored as ONE object tagged with the organization
  // they belong to. What is exposed is derived from it, so after an organization switch there is never
  // a render that pairs the new organization with the previous organization's branch/subscription.
  type OrgContext = GenericOrgContext<Branch, Subscription>
  const [ctx, setCtx] = useState<OrgContext | null>(null)
  const ctxReq = useRef(0)
  const [loading, setLoading] = useState(true)

  // Load every organization the user belongs to. A user may belong to several
  // organizations with different roles, so this must never be limited to one row.
  const loadOrgs = async (s: Session | null) => {
    if (!s) { setOrgs([]); setCurrentOrgId(null); return }
    const { data } = await supabase
      .from('organization_members')
      .select('role, organizations(id,name,tax_rate,currency)')
      .eq('user_id', s.user.id)
    const rows = (data ?? []) as unknown as { role: Role; organizations: { id: string; name: string; tax_rate: number; currency: string } }[]
    const list = rows
      .filter((r) => r.organizations)
      .map((r) => ({ id: r.organizations.id, name: r.organizations.name, taxRate: Number(r.organizations.tax_rate), currency: r.organizations.currency, role: r.role }))
    setOrgs(list)
    const saved = localStorage.getItem(CURRENT_ORG_KEY)
    const next = list.find((o) => o.id === saved)?.id ?? list[0]?.id ?? null
    setCurrentOrgId(next)
  }

  // Branches + subscription belong to whichever organization is current.
  const loadOrgContext = async (orgId: string | null) => {
    const req = ++ctxReq.current
    if (!orgId) { setCtx(null); return }
    const [{ data: branchRows }, { data: subRow }] = await Promise.all([
      supabase.from('branches').select('id,name,is_main').eq('org_id', orgId).eq('is_active', true).order('name'),
      supabase.from('subscriptions').select('status,trial_ends_at,current_period_end').eq('org_id', orgId).maybeSingle(),
    ])
    if (req !== ctxReq.current) return  // the user switched again meanwhile: drop this stale response
    const list = (branchRows ?? []).map((b) => ({ id: b.id as string, name: b.name as string, isMain: b.is_main as boolean }))
    const savedBranch = localStorage.getItem(CURRENT_BRANCH_KEY)  // UI preference only; the list above is what the database allows
    const nextBranch = chooseBranch(list, savedBranch)
    setCtx({ orgId, branches: list, currentBranchId: nextBranch,
      subscription: subRow ? { status: subRow.status as SubscriptionStatus, trialEndsAt: subRow.trial_ends_at, currentPeriodEnd: subRow.current_period_end } : null })
  }

  const reload = async () => { await loadOrgs(session) }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => { setSession(data.session); await loadOrgs(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); void loadOrgs(s) })
    return () => sub.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void loadOrgContext(currentOrgId) }, [currentOrgId])

  const switchOrg = (orgId: string) => { localStorage.setItem(CURRENT_ORG_KEY, orgId); localStorage.removeItem(CURRENT_BRANCH_KEY); setCurrentOrgId(orgId) }
  const switchBranch = (branchId: string) => {
    // Only branches the database returned for this organization can be selected.
    setCtx((c) => { const n = selectBranch(c, currentOrgId, branchId); if (n !== c) localStorage.setItem(CURRENT_BRANCH_KEY, branchId); return n })
  }

  const { branches, subscription, currentBranchId, contextLoading } = deriveOrgContext(ctx, currentOrgId)
  const org = useMemo(() => orgs.find((o) => o.id === currentOrgId) ?? null, [orgs, currentOrgId])
  const branch = useMemo(() => branches.find((b) => b.id === currentBranchId) ?? null, [branches, currentBranchId])
  const entitled = useMemo(() => isEntitled(subscription), [subscription])

  return (
    <C.Provider value={{ session, org, orgs, switchOrg, branch, branches, switchBranch, subscription, entitled, contextLoading, loading, reload }}>
      {children}
    </C.Provider>
  )
}
