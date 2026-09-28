import { describe, it, expect } from 'vitest'
import { addToCart, setQuantity, removeLine, type CartLine, type CartProduct } from './cart'
const cement: CartProduct = { id: 'c', name: 'Cement 42.5', stock_qty: 3 }
const hammer: CartProduct = { id: 'h', name: 'Hammer', stock_qty: 10 }
describe('cart', () => {
  it('adds a product, then increments the same line', () => {
    let r = addToCart<CartProduct>([], cement, false); r = addToCart(r.cart, cement, false)
    expect(r.cart).toHaveLength(1); expect(r.cart[0].qty).toBe(2)
  })
  it('refuses to exceed branch stock when negative stock is off, and names the product', () => {
    let cart: CartLine[] = []; for (let i = 0; i < 3; i++) cart = addToCart(cart, cement, false).cart
    const r = addToCart(cart, cement, false, 'Kumasi'); expect(r.cart[0].qty).toBe(3); expect(r.error).toMatch(/Only 3 of Cement 42\.5 in stock at Kumasi/)
  })
  it('allows exceeding stock when the organization allows negative stock', () => {
    let cart: CartLine[] = []; for (let i = 0; i < 5; i++) cart = addToCart(cart, cement, true).cart
    expect(cart[0].qty).toBe(5)
  })
  it('sets quantity manually, caps at stock, removes at zero, ignores junk', () => {
    const base = addToCart<CartProduct>([], cement, false).cart
    expect(setQuantity(base, 'c', 2, false)[0].qty).toBe(2)
    expect(setQuantity(base, 'c', 99, false)[0].qty).toBe(3)
    expect(setQuantity(base, 'c', 0, false)).toHaveLength(0)
    expect(setQuantity(base, 'c', NaN, false)[0].qty).toBe(1)
  })
  it('removes one line and keeps the others', () => {
    let cart = addToCart<CartProduct>([], cement, false).cart; cart = addToCart(cart, hammer, false).cart
    expect(removeLine(cart, 'c').map((l) => l.id)).toEqual(['h'])
  })
  it('does not mutate the previous cart (a failed checkout can keep the original)', () => {
    const before = addToCart<CartProduct>([], cement, false).cart; const snapshot = JSON.stringify(before)
    addToCart(before, cement, false); setQuantity(before, 'c', 2, false); expect(JSON.stringify(before)).toBe(snapshot)
  })
})
