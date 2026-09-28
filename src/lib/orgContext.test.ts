import { describe, it, expect } from 'vitest'
import { chooseBranch, deriveOrgContext, selectBranch, type OrgContext } from './orgContext'
type B = { id: string; isMain: boolean }
const ctxA: OrgContext<B, string> = { orgId: 'A', branches: [{ id: 'a1', isMain: true }, { id: 'a2', isMain: false }], currentBranchId: 'a2', subscription: 'A-active' }
describe('deriveOrgContext', () => {
  it('exposes the loaded context for the matching organization', () => {
    expect(deriveOrgContext(ctxA, 'A')).toMatchObject({ currentBranchId: 'a2', subscription: 'A-active', contextLoading: false })
  })
  it('after switching A → B, never exposes A\'s branch, branches or subscription; reports loading', () => {
    const d = deriveOrgContext(ctxA, 'B')
    expect(d).toEqual({ branches: [], subscription: null, currentBranchId: null, contextLoading: true })
  })
  it('is not "loading" when no organization is selected', () => expect(deriveOrgContext(ctxA, null).contextLoading).toBe(false))
})
describe('branch selection', () => {
  it('chooses the remembered branch only if the database returned it, else main, else first', () => {
    const l: B[] = [{ id: 'x', isMain: false }, { id: 'm', isMain: true }]
    expect(chooseBranch(l, 'x')).toBe('x'); expect(chooseBranch(l, 'not-mine')).toBe('m'); expect(chooseBranch([{ id: 'x', isMain: false }], null)).toBe('x'); expect(chooseBranch([], 'x')).toBeNull()
  })
  it('selects an authorized branch', () => expect(selectBranch(ctxA, 'A', 'a1')?.currentBranchId).toBe('a1'))
  it('ignores a branch id that was not returned for this organization (e.g. from another org or a forged value)', () => {
    expect(selectBranch(ctxA, 'A', 'b1')).toBe(ctxA)
  })
  it('ignores a selection made against a stale context', () => expect(selectBranch(ctxA, 'B', 'a1')).toBe(ctxA))
})
