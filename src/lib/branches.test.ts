import { describe, it, expect } from 'vitest'
import { branchFormSchema, deactivationBlock, needsFirstAssignmentWarning, type BranchRow } from './branches'

const rows = (over: Partial<BranchRow>[] = []): BranchRow[] =>
  [{ id: 'a', name: 'A', is_main: true, is_active: true }, { id: 'b', name: 'B', is_main: false, is_active: true }].map(
    (r, i) => ({ ...r, ...(over[i] ?? {}) }),
  )

describe('branch form validation', () => {
  it('requires a name and trims whitespace', () => {
    expect(branchFormSchema.safeParse({ name: '  ', address: '', phone: '' }).success).toBe(false)
    const p = branchFormSchema.safeParse({ name: '  Accra  ', address: '', phone: '' })
    expect(p.success).toBe(true)
    if (p.success) expect(p.data.name).toBe('Accra')
  })
  it('leaves address and phone optional', () => {
    const p = branchFormSchema.safeParse({ name: 'Main' })
    expect(p.success).toBe(true)
  })
})

describe('deactivation frontend guards', () => {
  it('blocks deactivating the main branch', () => {
    expect(deactivationBlock(rows(), 'a')).toMatch(/main/i)
  })
  it('blocks deactivating the only active branch', () => {
    expect(deactivationBlock(rows([{ is_main: false }, { is_active: false }]), 'a')).toMatch(/only active/i)
  })
  it('allows deactivating a non-main branch while others stay active', () => {
    expect(deactivationBlock(rows([{ is_main: false }]), 'a')).toBe(null)
  })
  it('does not block reactivating an inactive branch', () => {
    expect(deactivationBlock(rows([{}, { is_active: false }]), 'b')).toBe(null)
  })
})

describe('first-assignment warning', () => {
  it('warns only when the user has zero assignments (they can currently access all branches)', () => {
    expect(needsFirstAssignmentWarning([])).toBe(true)
    expect(needsFirstAssignmentWarning(['branch-1'])).toBe(false)
  })
})
