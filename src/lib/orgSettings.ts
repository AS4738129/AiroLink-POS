// Phase 6A — Organization Profile & Business Settings validation (pure).
// Only columns that already exist on `organizations` are handled here:
// name, address, phone, email, currency, tax_rate, allow_negative_stock.
// Bounds mirror the database (name length like create_organization, tax_rate
// 0–100 like its CHECK); nothing stricter is invented. RLS (org_upd:
// owner/super_admin) remains the enforcement — this is UX validation only.

export type OrgSettingsInput = {
  name: string
  address: string
  phone: string
  email: string
  currency: string
  taxRate: string // raw text from the form input; parsed on save
  allowNegativeStock: boolean
}

export type OrgSettingsErrors = Partial<
  Record<'name' | 'email' | 'currency' | 'taxRate', string>
>

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function validateOrgSettings(v: OrgSettingsInput): OrgSettingsErrors {
  const errors: OrgSettingsErrors = {}
  if (v.name.trim().length < 2)
    errors.name = 'Business name is required (at least 2 characters).'
  const email = v.email.trim()
  if (email && !EMAIL_RE.test(email))
    errors.email = 'Enter a valid email address (or leave it blank).'
  if (!v.currency.trim()) errors.currency = 'Currency is required.'
  const taxRaw = v.taxRate.trim()
  if (!taxRaw) {
    errors.taxRate = 'Tax rate is required.'
  } else {
    const t = Number(taxRaw)
    if (!Number.isFinite(t) || t < 0 || t > 100)
      errors.taxRate = 'Tax rate must be a number between 0 and 100.'
  }
  return errors
}

// Shape matches the existing `organizations` columns exactly (no new fields).
export function toOrgPayload(v: OrgSettingsInput) {
  return {
    name: v.name.trim(),
    address: v.address.trim() || null,
    phone: v.phone.trim() || null,
    email: v.email.trim() || null,
    currency: v.currency.trim(),
    tax_rate: Number(v.taxRate.trim()),
    allow_negative_stock: v.allowNegativeStock,
  }
}
