// Pure logic behind AuthProvider's organization/branch context (kept separate so it can be unit-tested).
export type OrgContext<B extends { id: string; isMain: boolean }, S> = { orgId: string; branches: B[]; currentBranchId: string | null; subscription: S | null }

// What the app may see for the currently selected organization. A context that was loaded for a
// DIFFERENT organization is never exposed (no new-org + old-branch/subscription pairing).
export function deriveOrgContext<B extends { id: string; isMain: boolean }, S>(ctx: OrgContext<B, S> | null, currentOrgId: string | null) {
  const active = ctx && ctx.orgId === currentOrgId ? ctx : null
  return { branches: active?.branches ?? [], subscription: active?.subscription ?? null, currentBranchId: active?.currentBranchId ?? null, contextLoading: !!currentOrgId && !active }
}
// A remembered preference is honoured only if the database returned that branch for this user.
export function chooseBranch<B extends { id: string; isMain: boolean }>(list: B[], saved: string | null): string | null {
  return list.find((b) => b.id === saved)?.id ?? list.find((b) => b.isMain)?.id ?? list[0]?.id ?? null
}
// Returns the new context if the branch is one this user was given for this organization, else the context unchanged.
export function selectBranch<B extends { id: string; isMain: boolean }, S>(ctx: OrgContext<B, S> | null, currentOrgId: string | null, branchId: string): OrgContext<B, S> | null {
  if (!ctx || ctx.orgId !== currentOrgId || !ctx.branches.some((b) => b.id === branchId)) return ctx
  return { ...ctx, currentBranchId: branchId }
}
