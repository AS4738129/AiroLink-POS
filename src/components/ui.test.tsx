import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmptyState, Notice, PageHeader, Spinner, StatusBadge, filterBarCls } from './ui'

describe('shared UI primitives', () => {
  it('PageHeader renders a title and description', () => {
    const html = renderToStaticMarkup(<PageHeader title="Inventory" description="Branch stock." />)
    expect(html).toContain('Inventory')
    expect(html).toContain('Branch stock.')
  })
  it('StatusBadge renders its label', () => {
    expect(renderToStaticMarkup(<StatusBadge tone="red">Out</StatusBadge>)).toContain('Out')
  })
  it('Notice exposes errors as alerts', () => {
    const html = renderToStaticMarkup(<Notice tone="err">Boom</Notice>)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Boom')
  })
  it('Spinner and EmptyState render accessible text', () => {
    expect(renderToStaticMarkup(<Spinner label="Loading…" />)).toContain('role="status"')
    expect(renderToStaticMarkup(<EmptyState title="Nothing here." />)).toContain('Nothing here.')
  })
  it('blue SaaS theme tokens stay in the shared primitives', () => {
    expect(renderToStaticMarkup(<PageHeader title="Sales" />)).toContain('text-ink-900')
    expect(filterBarCls).toContain('border-brand-100')
    expect(filterBarCls).toContain('bg-white')
  })
})
