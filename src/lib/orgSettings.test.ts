import { describe, it, expect } from 'vitest'
import { validateOrgSettings, toOrgPayload, type OrgSettingsInput } from './orgSettings'

const base: OrgSettingsInput = {
  name: 'Accra Mart',
  address: '12 Oxford Street',
  phone: '+233 20 000 0000',
  email: 'info@example.com',
  currency: 'GHS',
  taxRate: '3',
  allowNegativeStock: false,
}

describe('validateOrgSettings', () => {
  it('accepts a fully valid form', () => {
    expect(validateOrgSettings(base)).toEqual({})
  })
  it('accepts blank optional contact fields', () => {
    expect(validateOrgSettings({ ...base, address: '', phone: '', email: '' })).toEqual({})
  })
  it('rejects a missing business name', () => {
    expect(validateOrgSettings({ ...base, name: ' ' }).name).toMatch(/required/i)
    expect(validateOrgSettings({ ...base, name: 'A' }).name).toMatch(/required/i)
  })
  it('rejects an invalid email but keeps it optional', () => {
    expect(validateOrgSettings({ ...base, email: 'not-an-email' }).email).toMatch(/valid email/i)
    expect(validateOrgSettings({ ...base, email: '' })).toEqual({})
  })
  it('rejects a missing currency', () => {
    expect(validateOrgSettings({ ...base, currency: '  ' }).currency).toMatch(/required/i)
  })
  it('rejects a missing, non-numeric, negative or over-100 tax rate', () => {
    expect(validateOrgSettings({ ...base, taxRate: '' }).taxRate).toMatch(/required/i)
    expect(validateOrgSettings({ ...base, taxRate: 'abc' }).taxRate).toMatch(/between 0 and 100/i)
    expect(validateOrgSettings({ ...base, taxRate: '-1' }).taxRate).toMatch(/between 0 and 100/i)
    expect(validateOrgSettings({ ...base, taxRate: '101' }).taxRate).toMatch(/between 0 and 100/i)
  })
  it('accepts the 0–100 tax boundaries', () => {
    expect(validateOrgSettings({ ...base, taxRate: '0' })).toEqual({})
    expect(validateOrgSettings({ ...base, taxRate: '100' })).toEqual({})
  })
})

describe('toOrgPayload', () => {
  it('trims text, nulls blanks and parses the tax rate number', () => {
    expect(
      toOrgPayload({ ...base, name: '  Accra Mart ', address: '', phone: '  ', email: '', currency: ' ghs ', taxRate: ' 3 ' }),
    ).toEqual({
      name: 'Accra Mart',
      address: null,
      phone: null,
      email: null,
      currency: 'ghs',
      tax_rate: 3,
      allow_negative_stock: false,
    })
  })
  it('passes through populated contact fields and the stock flag', () => {
    const p = toOrgPayload({ ...base, allowNegativeStock: true })
    expect(p.address).toBe('12 Oxford Street')
    expect(p.allow_negative_stock).toBe(true)
  })
  it('emits only existing organizations columns', () => {
    expect(Object.keys(toOrgPayload(base)).sort()).toEqual(
      ['address', 'allow_negative_stock', 'currency', 'email', 'name', 'phone', 'tax_rate'].sort(),
    )
  })
})
