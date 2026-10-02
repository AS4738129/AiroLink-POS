import { z } from 'zod'

// Branch Management helpers (Phase 6B). Pure logic lives here so it can be
// unit-tested; the page itself (Branches.tsx) only wires it to Supabase.
// The database (RLS + constraints) remains the authority — these are
// frontend safety guards and UX helpers, never a security boundary.
export const branchFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
})
export type BranchFormValues = z.infer<typeof branchFormSchema>

export type BranchRow = { id: string; name: string; is_main: boolean; is_active: boolean }

// Frontend safety guards for deactivation (NOT database-enforced — the
// schema has no rule against deactivating a main or last-active branch,
// so the UI refuses to issue those updates and explains why).
export function deactivationBlock(rows: BranchRow[], targetId: string): string | null {
  const target = rows.find((b) => b.id === targetId)
  if (!target || !target.is_active) return null
  if (target.is_main) return 'The main branch cannot be deactivated. Set another branch as main first.'
  if (rows.filter((b) => b.is_active).length <= 1) {
    return 'This is the only active branch. Deactivating it would leave the business with no active branches.'
  }
  return null
}

// Existing authorization semantics: a user with ZERO branch_members rows can
// access ALL branches; the first assignment restricts them to assigned
// branches only. The UI must warn and require confirmation in that case.
export function needsFirstAssignmentWarning(assignedBranchIds: readonly string[]): boolean {
  return assignedBranchIds.length === 0
}
