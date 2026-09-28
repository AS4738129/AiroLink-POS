import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../features/auth/AuthProvider'
import { applyContextChange, type QueryContext } from '../lib/queryScope'

// Renders nothing. Watches the active user/organization/branch and keeps the TanStack Query cache in step.
export function ContextCacheSync() {
  const qc = useQueryClient(); const { session, org, branch } = useAuth()
  const ctx: QueryContext = { userId: session?.user.id ?? null, orgId: org?.id ?? null, branchId: branch?.id ?? null }
  const prev = useRef<QueryContext>(ctx)
  useEffect(() => {
    const last = prev.current
    if (last.userId === ctx.userId && last.orgId === ctx.orgId && last.branchId === ctx.branchId) return
    prev.current = ctx
    applyContextChange(qc, last, ctx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.userId, ctx.orgId, ctx.branchId, qc])
  return null
}
