// Pure cart operations (UX only — stock is re-validated atomically by complete_sale()).
export type CartProduct = { id: string; name: string; stock_qty: number }
export type CartLine<T extends CartProduct = CartProduct> = T & { qty: number }
export type CartResult<T extends CartProduct> = { cart: CartLine<T>[]; error?: string }

export function addToCart<T extends CartProduct>(cart: CartLine<T>[], p: T, allowNegative: boolean, branchName = 'this branch'): CartResult<T> {
  const cur = cart.find((l) => l.id === p.id); const next = (cur?.qty ?? 0) + 1
  if (!allowNegative && next > p.stock_qty) return { cart, error: `Only ${p.stock_qty} of ${p.name} in stock at ${branchName}.` }
  return { cart: cur ? cart.map((l) => (l.id === p.id ? { ...l, qty: next } : l)) : [...cart, { ...p, qty: 1 }] }
}
// Sets a quantity: <=0 removes the line, invalid input is ignored, and (unless negative stock is allowed) it is capped at available stock.
export function setQuantity<T extends CartProduct>(cart: CartLine<T>[], id: string, qty: number, allowNegative: boolean): CartLine<T>[] {
  if (!Number.isFinite(qty)) return cart
  return cart.map((l) => (l.id === id ? { ...l, qty: allowNegative || qty <= l.stock_qty ? qty : l.stock_qty } : l)).filter((l) => l.qty > 0)
}
export const removeLine = <T extends CartProduct>(cart: CartLine<T>[], id: string) => cart.filter((l) => l.id !== id)
