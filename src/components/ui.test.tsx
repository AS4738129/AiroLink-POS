import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CrudIcon, Dialog, EmptyState, Notice, PageHeader, Pager, RowAction, Spinner, StatusBadge, filterBarCls } from './ui'

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
  it('RowAction keeps its text label (icons are decorative only)', () => {
    const html = renderToStaticMarkup(<RowAction icon="edit">Edit</RowAction>)
    expect(html).toContain('Edit')
    expect(html).toContain('aria-hidden="true"')
  })
  it('Dialog is labelled and dismissible', () => {
    const html = renderToStaticMarkup(<Dialog label="Adjust stock" onClose={() => {}}>Body</Dialog>)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Adjust stock')
    expect(html).toContain('Close dialog')
  })
  it('Pager announces the current page', () => {
    const html = renderToStaticMarkup(<Pager page={1} total={45} pageSize={20} onPrev={() => {}} onNext={() => {}} />)
    expect(html).toContain('Page 2 of 3')
    expect(html).toContain('Previous page')
    expect(html).toContain('Next page')
  })
  it('CrudIcon renders every action icon without an icon library', () => {
    for (const name of ['add', 'edit', 'view', 'deactivate', 'activate', 'delete', 'close', 'receive', 'print', 'refresh', 'adjust', 'save', 'search'] as const) {
      expect(renderToStaticMarkup(<CrudIcon name={name} />)).toContain('<svg')
    }
  })
})
