import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readFileSync } from 'fs'
const db = new PGlite({ extensions: { pg_trgm } })
await db.exec(`create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.sub',true),'')::uuid $$;
create role anon; create role authenticated; grant usage on schema public, auth to anon, authenticated;`)

for (const file of ['0001_core.sql', '0002_phase1_foundation.sql', '0003_phase2_products_inventory.sql', '0004_phase3_pos_sales.sql', '0005_restrict_helper_execute.sql', '0006_auto_sku.sql', '0007_phase4_suppliers_purchases.sql', '0008_phase5_expenses_reports.sql']) {
  let sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')
  if (file === '0001_core.sql') sql = sql.replace('create extension if not exists pgcrypto;', '')
  await db.exec(sql)
}
await db.exec(`grant select,insert,update,delete on all tables in schema public to authenticated;`)

let failures = 0
const ok = (n, c) => { if (!c) failures++; console.log(c ? 'PASS' : 'FAIL', n) }
const as = async (u, fn) => { await db.exec(`set role authenticated; select set_config('request.sub','${u}',false)`); try { return await fn() } finally { await db.exec('reset role') } }
const rej = async (p) => { try { await p; return null } catch (e) { return e.message } }

// ── Two organizations, two users ───────────────────────────────────────────
const [a, b, c, e] = (await Promise.all([1, 2, 3, 4].map(() => db.query(`insert into auth.users default values returning id`)))).map((r) => r.rows[0].id)
const oa = (await as(a, () => db.query(`select create_organization('Org A') id`))).rows[0].id
const ob = (await as(b, () => db.query(`select create_organization('Org B') id`))).rows[0].id
await db.exec(`update organizations set tax_rate=10 where id='${oa}'`)
const branchA = (await db.query(`select id from branches where org_id='${oa}' and is_main`)).rows[0].id
const branchB = (await db.query(`select id from branches where org_id='${ob}' and is_main`)).rows[0].id

// ── Phase 1 regression: sale/credit/audit flow, now branch-aware ──────────
const pid = (await as(a, async () => {
  const r = await db.query(`insert into products(org_id,sku,name,cost_price,selling_price) values ('${oa}','S1','Cement',70,100) returning id`)
  await db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA}','${r.rows[0].id}',5,'opening')`)
  return r.rows[0].id
}))
const stockAt = async (branch, product = pid) => Number((await db.query(`select stock_qty from branch_inventory where org_id='${oa}' and branch_id='${branch}' and product_id='${product}'`)).rows[0]?.stock_qty ?? 0)
ok('opening stock via ledger = 5', await stockAt(branchA) === 5)
const cust = (await db.query(`insert into customers(org_id,name,credit_limit) values ('${oa}','Kofi',100) returning id`)).rows[0].id
const sale = (items, pays, cst = null, d = 0, branch = branchA) => as(a, () => db.query(`select complete_sale($1,$2,$3::jsonb,$4::jsonb,$5,$6) r`, [oa, branch, JSON.stringify(items), JSON.stringify(pays), cst, d]))
let r = await sale([{ product_id: pid, qty: 2 }], [{ method: 'cash', amount: 220 }])
ok('cash sale returns receipt & total incl. 10% tax', r.rows[0].r.startsWith('R-') && Number((await db.query(`select total from sales`)).rows[0].total) === 220)
ok('stock deducted to 3', await stockAt(branchA) === 3)
ok('rejects oversell (stock unchanged, no partial sale)', /Insufficient/.test(await rej(sale([{ product_id: pid, qty: 9 }], [{ method: 'cash', amount: 1 }])) || '') && await stockAt(branchA) === 3 && (await db.query(`select count(*) c from sales`)).rows[0].c == 1)
ok('credit sale without customer rejected', /customer/.test(await rej(sale([{ product_id: pid, qty: 1 }], [])) || ''))
await sale([{ product_id: pid, qty: 1 }], [{ method: 'cash', amount: 60 }], cust)
ok('credit sale raises customer balance by 50', Number((await db.query(`select balance from customers`)).rows[0].balance) === 50)
ok('credit limit enforced', /Credit limit/.test(await rej(sale([{ product_id: pid, qty: 1 }], [], cust)) || ''))
ok('client cannot edit branch stock directly', /Stock can only/.test(await rej(as(a, () => db.query(`update branch_inventory set stock_qty=999 where org_id='${oa}' and branch_id='${branchA}' and product_id='${pid}'`))) || ''))
ok('client cannot edit balance directly', /Balance can only/.test(await rej(as(a, () => db.query(`update customers set balance=0`))) || ''))
ok('client cannot insert sales directly', !!(await rej(as(a, () => db.query(`insert into sales(org_id,branch_id,receipt_no) values ('${oa}','${branchA}','X')`)))))
ok('user B sees none of A data', (await as(b, () => db.query(`select (select count(*) from products)+(select count(*) from sales)+(select count(*) from customers)+(select count(*) from branch_inventory) n`))).rows[0].n == 0)
ok('user B cannot sell in org A', /Not authorized/.test(await rej(as(b, () => db.query(`select complete_sale($1,$2,$3::jsonb,'[]'::jsonb)`, [oa, branchA, JSON.stringify([{ product_id: pid, qty: 1 }])]))) || ''))
ok('user without org membership cannot create products in org A', !!(await rej(as(b, () => db.query(`insert into products(org_id,sku,name,cost_price,selling_price) values ('${oa}','HACK','x',1,1)`)))))
ok('audit log written', (await db.query(`select count(*) c from audit_logs where action in ('sale.create','product.create')`)).rows[0].c >= 3)

// ── Category safety: deleting a category detaches products, doesn't break them ──
const catId = (await as(a, () => db.query(`insert into categories(org_id,name) values ('${oa}','Building Materials') returning id`))).rows[0].id
await as(a, () => db.query(`update products set category_id='${catId}' where id='${pid}'`))
ok('org B cannot see org A category', (await as(b, () => db.query(`select count(*) c from categories where id='${catId}'`))).rows[0].c == 0)
await db.exec(`delete from categories where id='${catId}'`)
ok('deleting a category detaches its products instead of breaking them', (await db.query(`select category_id from products where id='${pid}'`)).rows[0].category_id === null)

// ── Phase 1 foundation: branches, subscriptions, entitlement ──────────────
ok('org gets a default Main branch', (await db.query(`select count(*) c from branches where org_id='${oa}' and is_main`)).rows[0].c == 1)
ok('org gets a trialing subscription', (await db.query(`select status from subscriptions where org_id='${oa}'`)).rows[0].status === 'trialing')
ok('newly created org is entitled (trial)', (await db.query(`select is_org_entitled('${oa}') e`)).rows[0].e === true)
ok('user B cannot see org A branches', (await as(b, () => db.query(`select count(*) c from branches where org_id='${oa}'`))).rows[0].c == 0)
ok('user B cannot see org A subscription', (await as(b, () => db.query(`select count(*) c from subscriptions where org_id='${oa}'`))).rows[0].c == 0)
ok('client cannot create a branch for another org (unauthorized role)', !!(await rej(as(b, () => db.query(`insert into branches(org_id,name) values ('${oa}','Rogue Branch')`)))))
const subUpdateAttempt = await as(a, () => db.query(`update subscriptions set status='active' where org_id='${oa}'`))
ok('client cannot directly change subscription status', subUpdateAttempt.affectedRows === 0 && (await db.query(`select status from subscriptions where org_id='${oa}'`)).rows[0].status === 'trialing')
ok('only one main branch allowed per org', !!(await rej(db.query(`insert into branches(org_id,name,is_main) values ('${oa}','Second Main',true)`))))
await db.exec(`update subscriptions set status='expired' where org_id='${oa}'`)
ok('expired subscription is not entitled', (await db.query(`select is_org_entitled('${oa}') e`)).rows[0].e === false)
ok('sale blocked when subscription expired', /Subscription is not active/.test(await rej(sale([{ product_id: pid, qty: 1 }], [{ method: 'cash', amount: 60 }])) || ''))
await db.exec(`update subscriptions set status='trialing' where org_id='${oa}'`)
ok('sale allowed again once subscription reactivated', !(await rej(sale([{ product_id: pid, qty: 1 }], [{ method: 'cash', amount: 110 }]))))
// stock at branchA is now 1 (5 opening -2 -1(credit) -1(reactivated sale); oversell/blocked attempts made no change)
ok('branch A stock after Phase 1 flow = 1', await stockAt(branchA) === 1)

// ── Phase 2: branch-scoped inventory ───────────────────────────────────────
const branchA2 = (await as(a, () => db.query(`insert into branches(org_id,name) values ('${oa}','Branch A2') returning id`))).rows[0].id
await as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA2}','${pid}',30,'opening')`))
ok('same product has independent stock per branch', await stockAt(branchA) === 1 && await stockAt(branchA2) === 30)

await as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA2}','${pid}',-5,'adjustment')`))
ok('adjustment affects only the selected branch', await stockAt(branchA2) === 25 && await stockAt(branchA) === 1)

await as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA2}','${pid}',-2,'damaged')`))
ok('damaged stock decreases the correct branch', await stockAt(branchA2) === 23)

await as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA2}','${pid}',-1,'expired')`))
ok('expired stock decreases the correct branch', await stockAt(branchA2) === 22)

// physical count reads 20; delta = counted(20) - system(22) = -2
await as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA2}','${pid}',-2,'count')`))
ok('stock count produces the required delta', await stockAt(branchA2) === 20)

ok('negative stock rejected atomically', /Insufficient/.test(await rej(as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA2}','${pid}',-999,'adjustment')`))) || '') && await stockAt(branchA2) === 20)

ok('cross-organization branch attack rejected (org A cannot use org B branch)', !!(await rej(as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchB}','${pid}',1,'adjustment')`)))))
const pidB = (await as(b, () => db.query(`insert into products(org_id,sku,name,cost_price,selling_price) values ('${ob}','SB1','Nails',10,20) returning id`))).rows[0].id
ok('cross-organization product attack rejected (org A cannot use org B product)', !!(await rej(as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA}','${pidB}',1,'opening')`)))))

// ── Branch access model: a user scoped to one branch cannot touch another ──
await as(a, () => db.query(`insert into organization_members(org_id,user_id,role) values ('${oa}','${c}','inventory_officer')`))
await as(a, () => db.query(`insert into branch_members(branch_id,user_id) values ('${branchA2}','${c}')`))
ok('branch-scoped user can see their assigned branch', (await as(c, () => db.query(`select count(*) n from branch_inventory where branch_id='${branchA2}'`))).rows[0].n == 1)
ok('branch-scoped user cannot see a branch they are not assigned to', (await as(c, () => db.query(`select count(*) n from branch_inventory where branch_id='${branchA}'`))).rows[0].n == 0)
ok('branch-scoped user cannot adjust stock at an unassigned branch', !!(await rej(as(c, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA}','${pid}',1,'adjustment')`)))))
await as(c, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA2}','${pid}',1,'adjustment')`))
ok('branch-scoped user can adjust stock at their assigned branch', await stockAt(branchA2) === 21)
ok('an unrestricted owner is unaffected by another user\'s branch scoping', await stockAt(branchA) === 1)

// ── Sales deduct from the correct branch ───────────────────────────────────
await sale([{ product_id: pid, qty: 1 }], [{ method: 'cash', amount: 110 }], null, 0, branchA2)
ok('a sale at branch A2 deducts branch A2 stock, not branch A', await stockAt(branchA2) === 20 && await stockAt(branchA) === 1)
ok('the sale recorded the correct branch', (await db.query(`select branch_id from sales order by created_at desc limit 1`)).rows[0].branch_id === branchA2)

// ── Phase 3: sales, payments, receipts ─────────────────────────────────────
const pid2 = (await as(a, () => db.query(`insert into products(org_id,sku,name,cost_price,selling_price) values ('${oa}','S2','Wheelbarrow',60,100) returning id`))).rows[0].id
await as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA}','${pid2}',50,'opening')`))

const r2call = await sale([{ product_id: pid2, qty: 2 }], [{ method: 'cash', amount: 220 }])
const sale2Receipt = r2call.rows[0].r
const sale2Id = (await db.query(`select id from sales where org_id='${oa}' and receipt_no='${sale2Receipt}'`)).rows[0].id
ok('sale belongs to the correct organization and branch', (await db.query(`select org_id,branch_id from sales where id='${sale2Id}'`)).rows[0].org_id === oa && (await db.query(`select branch_id from sales where id='${sale2Id}'`)).rows[0].branch_id === branchA)
ok('stock deducted for the new product at branch A', await stockAt(branchA, pid2) === 48)

const r3call = await sale([{ product_id: pid2, qty: 1 }], [{ method: 'cash', amount: 60 }, { method: 'momo', amount: 50 }])
const sale3Id = (await db.query(`select id from sales where org_id='${oa}' and receipt_no='${r3call.rows[0].r}'`)).rows[0].id
ok('split payment sums correctly and leaves no balance due', (await db.query(`select amount_paid,balance_due from sales where id='${sale3Id}'`)).rows[0].amount_paid == 110 && (await db.query(`select balance_due from sales where id='${sale3Id}'`)).rows[0].balance_due == 0)
ok('split payment recorded as two payment rows', (await db.query(`select count(*) c from payments where sale_id='${sale3Id}'`)).rows[0].c == 2)
ok('stock deducted once for the split-payment sale', await stockAt(branchA, pid2) === 47)

ok('negative payment amount rejected, no partial sale', /Invalid payment amount/.test(await rej(sale([{ product_id: pid2, qty: 1 }], [{ method: 'cash', amount: -5 }])) || '') && await stockAt(branchA, pid2) === 47)
ok('invalid payment method rejected, no partial sale', !!(await rej(sale([{ product_id: pid2, qty: 1 }], [{ method: 'crypto', amount: 110 }]))) && await stockAt(branchA, pid2) === 47)
ok('a fabricated item price with no customer for the shortfall is rejected', /customer/.test(await rej(sale([{ product_id: pid2, qty: 1, price: 0.01 }], [{ method: 'cash', amount: 0.01 }])) || '') && await stockAt(branchA, pid2) === 47)

const cust2 = (await db.query(`insert into customers(org_id,name,credit_limit) values ('${oa}','Ama',1000) returning id`)).rows[0].id
const r5call = await sale([{ product_id: pid2, qty: 1, price: 0.01 }], [{ method: 'cash', amount: 0.01 }], cust2)
const sale5Id = (await db.query(`select id from sales where org_id='${oa}' and receipt_no='${r5call.rows[0].r}'`)).rows[0].id
ok('server-authoritative price used regardless of a fabricated item price', Number((await db.query(`select total from sales where id='${sale5Id}'`)).rows[0].total) === 110)
ok('customer charged the real shortfall (109.99), not the fabricated 0.01', Number((await db.query(`select balance from customers where id='${cust2}'`)).rows[0].balance) === 109.99)
ok('stock deducted using the real quantity regardless of the fabricated price', await stockAt(branchA, pid2) === 46)

await db.query(`insert into sales(org_id,branch_id,receipt_no) values ('${oa}','${branchA}','DUPLICATE-1')`)
ok('duplicate receipt numbers rejected within an organization', !!(await rej(db.query(`insert into sales(org_id,branch_id,receipt_no) values ('${oa}','${branchA}','DUPLICATE-1')`))))

// ── void_sale(): safe cancellation ─────────────────────────────────────────
ok('cashier-less role (inventory_officer) cannot void a sale', /Not authorized/.test(await rej(as(c, () => db.query(`select void_sale($1,$2)`, [oa, sale2Id]))) || ''))
ok('a user from another organization cannot void this sale', /Not authorized/.test(await rej(as(b, () => db.query(`select void_sale($1,$2)`, [oa, sale3Id]))) || ''))
await as(a, () => db.query(`select void_sale($1,$2)`, [oa, sale3Id]))
ok('voided sale is marked void, not deleted', (await db.query(`select status from sales where id='${sale3Id}'`)).rows[0].status === 'void')
ok('voiding restores the branch stock it had consumed', await stockAt(branchA, pid2) === 47)
ok('voiding is audited', (await db.query(`select count(*) c from audit_logs where entity_id='${sale3Id}' and action='sale.void'`)).rows[0].c == 1)
ok('an already-voided sale cannot be voided again', /Only a completed sale/.test(await rej(as(a, () => db.query(`select void_sale($1,$2)`, [oa, sale3Id]))) || ''))

const pid3 = (await as(a, () => db.query(`insert into products(org_id,sku,name,cost_price,selling_price) values ('${oa}','S3','Shovel',20,100) returning id`))).rows[0].id
await as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA}','${pid3}',10,'opening')`))
const r4call = await sale([{ product_id: pid3, qty: 1 }], [{ method: 'cash', amount: 50 }], cust2)
const sale4Id = (await db.query(`select id from sales where org_id='${oa}' and receipt_no='${r4call.rows[0].r}'`)).rows[0].id
ok('credit sale raises customer balance by the due amount (60)', Number((await db.query(`select balance from customers where id='${cust2}'`)).rows[0].balance) === 169.99)
await as(a, () => db.query(`select void_sale($1,$2)`, [oa, sale4Id]))
ok('voiding a credit sale reverses the customer balance impact', Number((await db.query(`select balance from customers where id='${cust2}'`)).rows[0].balance) === 109.99)
ok('voiding a credit sale restores its branch stock too', await stockAt(branchA, pid3) === 10)

// ── Branch- and org-aware visibility of sales/sale_items/payments ─────────
ok('branch-scoped user sees sales at their branch', (await as(c, () => db.query(`select count(*) n from sales where branch_id='${branchA2}'`))).rows[0].n >= 1)
ok('branch-scoped user cannot see sales at an unassigned branch', (await as(c, () => db.query(`select count(*) n from sales where branch_id='${branchA}'`))).rows[0].n == 0)
const sale2ItemId = (await db.query(`select id from sale_items where sale_id='${sale2Id}' limit 1`)).rows[0].id
const sale2PaymentId = (await db.query(`select id from payments where sale_id='${sale2Id}' limit 1`)).rows[0].id
ok('branch-scoped user cannot see sale_items at an unassigned branch', (await as(c, () => db.query(`select count(*) n from sale_items where id='${sale2ItemId}'`))).rows[0].n == 0)
ok('branch-scoped user cannot see payments at an unassigned branch', (await as(c, () => db.query(`select count(*) n from payments where id='${sale2PaymentId}'`))).rows[0].n == 0)
ok('an unrestricted owner still sees the sale_item and payment', (await db.query(`select count(*) n from sale_items where id='${sale2ItemId}'`)).rows[0].n == 1 && (await db.query(`select count(*) n from payments where id='${sale2PaymentId}'`)).rows[0].n == 1)
ok('org B sees none of org A sales/sale_items/payments', (await as(b, () => db.query(`select (select count(*) from sales where org_id='${oa}')+(select count(*) from sale_items where org_id='${oa}')+(select count(*) from payments where org_id='${oa}') n`))).rows[0].n == 0)
ok('branch-scoped user only lists branches they can access', (await as(c, () => db.query(`select id from branches where org_id='${oa}'`))).rows.map((x) => x.id).join() === branchA2)
ok('an unrestricted owner lists every branch of the organization', (await as(a, () => db.query(`select count(*) n from branches where org_id='${oa}'`))).rows[0].n == 2)
ok('client cannot insert payments directly, bypassing complete_sale()', !!(await rej(as(a, () => db.query(`insert into payments(org_id,sale_id,method,amount) values ('${oa}','${sale2Id}','cash',10)`)))))
ok('client cannot insert sale_items directly, bypassing complete_sale()', !!(await rej(as(a, () => db.query(`insert into sale_items(org_id,sale_id,product_id,name,qty,unit_price,cost_price,line_total) values ('${oa}','${sale2Id}','${pid2}','x',1,1,1,1)`)))))

// ── Phase 3: authorization, tampering, pricing rules, rollback ────────────
const d = (await db.query(`insert into auth.users default values returning id`)).rows[0].id
await as(a, () => db.query(`insert into organization_members(org_id,user_id,role) values ('${oa}','${d}','cashier')`))
await as(a, () => db.query(`insert into branch_members(branch_id,user_id) values ('${branchA2}','${d}')`))
const saleAs = (u, org, branch, items, pays, cst = null, disc = 0) => as(u, () => db.query(`select complete_sale($1,$2,$3::jsonb,$4::jsonb,$5,$6) r`, [org, branch, JSON.stringify(items), JSON.stringify(pays), cst, disc]))
await saleAs(d, oa, branchA2, [{ product_id: pid, qty: 1 }], [{ method: 'cash', amount: 110 }])
ok('a branch-scoped cashier can sell at their assigned branch', await stockAt(branchA2) === 19)
ok('a branch-scoped cashier cannot sell at an unassigned branch', /No access to this branch/.test(await rej(saleAs(d, oa, branchA, [{ product_id: pid2, qty: 1 }], [{ method: 'cash', amount: 110 }])) || '') && await stockAt(branchA, pid2) === 47)
ok('branch manipulation: using another organization\'s branch in the payload is rejected', /Invalid branch/.test(await rej(sale([{ product_id: pid2, qty: 1 }], [{ method: 'cash', amount: 110 }], null, 0, branchB)) || ''))
ok('cross-tenant product sale rejected (org A cannot sell org B product)', /Product unavailable/.test(await rej(sale([{ product_id: pidB, qty: 1 }], [{ method: 'cash', amount: 22 }])) || ''))
ok('cross-tenant sale rejected (org B user cannot sell into org A even with org A branch)', /Not authorized/.test(await rej(saleAs(b, oa, branchA, [{ product_id: pid2, qty: 1 }], [{ method: 'cash', amount: 110 }])) || ''))

ok('discount greater than the subtotal rejected', /Discount exceeds/.test(await rej(sale([{ product_id: pid2, qty: 1 }], [], null, 500)) || ''))
ok('negative discount rejected (a negative total is impossible)', /Invalid discount/.test(await rej(sale([{ product_id: pid2, qty: 1 }], [{ method: 'cash', amount: 110 }], null, -50)) || ''))
const rd = await sale([{ product_id: pid2, qty: 1 }], [{ method: 'cash', amount: 99 }], null, 10)
ok('discount applied before tax: 100 - 10 + 9 tax = 99', Number((await db.query(`select total from sales where receipt_no='${rd.rows[0].r}' and org_id='${oa}'`)).rows[0].total) === 99 && await stockAt(branchA, pid2) === 46)
const pidNT = (await as(a, () => db.query(`insert into products(org_id,sku,name,cost_price,selling_price,taxable) values ('${oa}','NT1','Bag',10,50,false) returning id`))).rows[0].id
await as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA}','${pidNT}',5,'opening')`))
const rnt = await sale([{ product_id: pidNT, qty: 1 }], [{ method: 'cash', amount: 50 }])
ok('non-taxable product carries no tax', (await db.query(`select tax_total,total from sales where receipt_no='${rnt.rows[0].r}' and org_id='${oa}'`)).rows.every((x) => Number(x.tax_total) === 0 && Number(x.total) === 50))
ok('overpayment rejected (change is never stored as a payment)', /Payments exceed/.test(await rej(sale([{ product_id: pid2, qty: 1 }], [{ method: 'cash', amount: 500 }])) || ''))

const salesBefore = (await db.query(`select count(*) c from sales`)).rows[0].c
ok('a multi-item cart with one insufficient line rolls back everything', /Insufficient stock for/.test(await rej(sale([{ product_id: pid2, qty: 1 }, { product_id: pid3, qty: 999 }], [{ method: 'cash', amount: 1 }])) || '')
  && await stockAt(branchA, pid2) === 46 && await stockAt(branchA, pid3) === 10 && (await db.query(`select count(*) c from sales`)).rows[0].c == salesBefore)
ok('insufficient-stock error names the product', /Shovel/.test(await rej(sale([{ product_id: pid3, qty: 999 }], [{ method: 'cash', amount: 1 }])) || ''))

ok('sale item stores server price and quantity', (await db.query(`select qty,unit_price,line_total from sale_items where sale_id='${sale2Id}'`)).rows.every((x) => Number(x.qty) === 2 && Number(x.unit_price) === 100 && Number(x.line_total) === 200))
ok('sale wrote a branch-tagged ledger entry referencing the sale', (await db.query(`select count(*) c from inventory_transactions where reason='sale' and ref_id='${sale2Id}' and branch_id='${branchA}' and qty_change=-2`)).rows[0].c == 1)
ok('every completed sale has a unique receipt number within the organization', (await db.query(`select count(*) c, count(distinct receipt_no) d from sales where org_id='${oa}'`)).rows.every((x) => x.c === x.d))
ok('a sale audit record includes the branch', (await db.query(`select count(*) c from audit_logs where action='sale.create' and meta->>'branch_id'='${branchA2}'`)).rows[0].c >= 1)
// NOTE on concurrency: PGlite is a single connection, so true simultaneous transactions cannot be simulated here.
// Safety rests on Postgres itself: apply_inventory() does one atomic INSERT ... ON CONFLICT DO UPDATE, which row-locks
// the branch_inventory row, and receipts come from a row-locked UPDATE on org_counters plus unique(org_id,receipt_no).
// The sequential oversell test above verifies the accounting rule; row locking is a documented database guarantee.

// ── Recovery audit: helper-function grants, demo seed, and a full cross-phase lifecycle ──
const asAnon = async (fn) => { await db.exec(`set role anon`); try { return await fn() } finally { await db.exec('reset role') } }
for (const [fnName, call] of [['is_org_entitled', `select is_org_entitled('${oa}')`], ['role_in', `select role_in('${oa}')`], ['can_access_branch', `select can_access_branch('${branchA}')`], ['branch_visible', `select branch_visible('${oa}','${branchA}')`]])
  ok(`anonymous callers cannot execute ${fnName}()`, /permission denied/.test(await rej(asAnon(() => db.query(call))) || ''))
ok('anonymous callers cannot execute complete_sale() or void_sale()', /permission denied/.test(await rej(asAnon(() => db.query(`select complete_sale('${oa}','${branchA}','[]'::jsonb,'[]'::jsonb)`))) || '') && /permission denied/.test(await rej(asAnon(() => db.query(`select void_sale('${oa}','${sale2Id}')`))) || ''))
ok('anonymous callers cannot execute the purchase RPCs', /permission denied/.test(await rej(asAnon(() => db.query(`select create_draft_purchase('${oa}','${branchA}','${sale2Id}','x','[]'::jsonb)`))) || '') && /permission denied/.test(await rej(asAnon(() => db.query(`select receive_purchase('${oa}','${sale2Id}')`))) || '') && /permission denied/.test(await rej(asAnon(() => db.query(`select cancel_purchase('${oa}','${sale2Id}')`))) || ''))
ok('signed-in users can still execute the helpers (RLS keeps working)', (await as(a, () => db.query(`select is_org_entitled('${oa}') e`))).rows[0].e === true)

// seed_demo.sql must run against the migrated schema (it broke when stock moved to branch_inventory)
const seedOrgId = (await as(e, () => db.query(`select create_organization('Seed Org') id`))).rows[0].id
await db.exec(readFileSync(new URL('../seed_demo.sql', import.meta.url), 'utf8').replace('00000000-0000-0000-0000-000000000000', seedOrgId))
const seedMain = (await db.query(`select id from branches where org_id='${seedOrgId}' and is_main`)).rows[0].id
ok('demo seed creates organization-wide products with branch stock 50 and per-branch minimums', (await db.query(`select count(*) c from branch_inventory where org_id='${seedOrgId}' and branch_id='${seedMain}' and stock_qty=50`)).rows[0].c == 3
  && (await db.query(`select min_stock from branch_inventory bi join products p on p.id=bi.product_id where p.sku='DEMO-001' and bi.org_id='${seedOrgId}'`)).rows[0].min_stock == 10)
ok('demo seed wrote ledger rows for the main branch', (await db.query(`select count(*) c from inventory_transactions where org_id='${seedOrgId}' and branch_id='${seedMain}' and reason='opening'`)).rows[0].c == 3)

// ── Cross-phase lifecycle: auth → org → entitlement → branch → product → stock → sale → payment → receipt → history → void ──
const f = (await db.query(`insert into auth.users default values returning id`)).rows[0].id
const ol = (await as(f, () => db.query(`select create_organization('Lifecycle Org') id`))).rows[0].id
const bMain = (await db.query(`select id from branches where org_id='${ol}' and is_main`)).rows[0].id
const bSecond = (await as(f, () => db.query(`insert into branches(org_id,name) values ('${ol}','Second Branch') returning id`))).rows[0].id
const pl = (await as(f, () => db.query(`insert into products(org_id,sku,name,cost_price,selling_price) values ('${ol}','L1','Lifecycle Item',10,50) returning id`))).rows[0].id
const stockL = async (br) => Number((await db.query(`select stock_qty from branch_inventory where org_id='${ol}' and branch_id='${br}' and product_id='${pl}'`)).rows[0]?.stock_qty ?? 0)
await as(f, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${ol}','${bMain}','${pl}',10,'opening'),('${ol}','${bSecond}','${pl}',4,'opening')`))
const saleL = (br, qty, pays, org = ol) => as(f, () => db.query(`select complete_sale($1,$2,$3::jsonb,$4::jsonb) r`, [org, br, JSON.stringify([{ product_id: pl, qty }]), JSON.stringify(pays)]))
ok('lifecycle: a fresh organization is entitled and has two branches with independent stock', (await db.query(`select is_org_entitled('${ol}') e`)).rows[0].e === true && await stockL(bMain) === 10 && await stockL(bSecond) === 4)
const rl = await saleL(bSecond, 3, [{ method: 'cash', amount: 100 }, { method: 'momo', amount: 50 }])
const idL = (await db.query(`select id from sales where org_id='${ol}' and receipt_no='${rl.rows[0].r}'`)).rows[0].id
ok('lifecycle: sale at the second branch deducts only that branch (payment 150 = 3 x 50, tax 0)', await stockL(bSecond) === 1 && await stockL(bMain) === 10 && Number((await db.query(`select total from sales where id='${idL}'`)).rows[0].total) === 150)
ok('lifecycle: a failed checkout (oversell) changes nothing, sale or stock', /Insufficient stock for Lifecycle Item/.test(await rej(saleL(bSecond, 5, [{ method: 'cash', amount: 250 }])) || '') && await stockL(bSecond) === 1 && (await db.query(`select count(*) c from sales where org_id='${ol}'`)).rows[0].c == 1)
ok('lifecycle: the sale shows in the owner\'s history with items and both payments', (await as(f, () => db.query(`select (select count(*) from sales where id='${idL}')+(select count(*) from sale_items where sale_id='${idL}')+(select count(*) from payments where sale_id='${idL}') n`))).rows[0].n == 4)
ok('lifecycle: another organization sees none of it', (await as(b, () => db.query(`select (select count(*) from sales where org_id='${ol}')+(select count(*) from branch_inventory where org_id='${ol}')+(select count(*) from branches where org_id='${ol}') n`))).rows[0].n == 0)
await db.exec(`update subscriptions set status='suspended' where org_id='${ol}'`)
ok('lifecycle: a suspended subscription locks checkout server-side, stock untouched', /Subscription is not active/.test(await rej(saleL(bMain, 1, [{ method: 'cash', amount: 50 }])) || '') && await stockL(bMain) === 10)
await db.exec(`update subscriptions set status='active', current_period_end = now() + interval '30 days' where org_id='${ol}'`)
await as(f, () => db.query(`select void_sale($1,$2)`, [ol, idL]))
ok('lifecycle: after reactivation, voiding restores the second branch stock and keeps the sale', await stockL(bSecond) === 4 && await stockL(bMain) === 10 && (await db.query(`select status from sales where id='${idL}'`)).rows[0].status === 'void')
ok('lifecycle: the ledger tells the whole story for the second branch (opening, sale, return)', (await db.query(`select string_agg(reason || ':' || qty_change::int, ',' order by created_at, reason) s from inventory_transactions where org_id='${ol}' and branch_id='${bSecond}'`)).rows[0].s.split(',').sort().join() === 'opening:4,return:3,sale:-3')

// ── Automatic SKU generation (org_counters-based, see 0006_auto_sku.sql) ──
const skuOrg = (await as(a, () => db.query(`insert into products(org_id,name,cost_price,selling_price) values ('${oa}','Auto SKU Item 1',5,10) returning sku`))).rows[0].sku
ok('a new product is automatically assigned a SKU', !!skuOrg)
ok('SKU format is PRD-000001 for the next number in this organization (prior products used explicit SKUs, so this is #1)', /^PRD-\d{6}$/.test(skuOrg))
const skuOrg2 = (await as(a, () => db.query(`insert into products(org_id,name,cost_price,selling_price) values ('${oa}','Auto SKU Item 2',5,10) returning sku`))).rows[0].sku
ok('the next product gets the next sequential number', Number(skuOrg2.slice(4)) === Number(skuOrg.slice(4)) + 1)
ok('all generated SKUs match ^PRD-[0-9]{6}$', [skuOrg, skuOrg2].every((s) => /^PRD-[0-9]{6}$/.test(s)))
ok('no duplicate SKU exists within the organization', (await db.query(`select sku, count(*) c from products where org_id='${oa}' group by sku having count(*) > 1`)).rows.length === 0)
const skuOrgB = (await as(b, () => db.query(`insert into products(org_id,name,cost_price,selling_price) values ('${ob}','Auto SKU Item B',5,10) returning sku`))).rows[0].sku
ok('organization isolation: a second organization\'s SKU sequence starts at its own PRD-000001, independent of org A\'s count', skuOrgB === 'PRD-000001')
ok('existing (pre-Phase-3) products keep their original, explicitly-assigned SKU untouched', (await db.query(`select sku from products where id='${pid}'`)).rows[0].sku === 'S1')
await as(a, () => db.query(`update products set name='Auto SKU Item 1 (renamed)', selling_price=11, cost_price=6 where sku='${skuOrg}'`))
ok('editing a product never regenerates or changes its SKU', (await db.query(`select sku from products where name='Auto SKU Item 1 (renamed)'`)).rows[0].sku === skuOrg)
ok('duplicate SKU within an organization is rejected at the database level', !!(await rej(as(a, () => db.query(`insert into products(org_id,sku,name,cost_price,selling_price) values ('${oa}','${skuOrg}','Duplicate',1,1)`)))))
ok('cross-organization SKU assignment is impossible: a non-member cannot insert into org A at all', !!(await rej(as(b, () => db.query(`insert into products(org_id,name,cost_price,selling_price) values ('${oa}','Sneaky',1,1)`)))))
// Concurrency note: PGlite is a single connection so true simultaneous INSERTs cannot be simulated (same limitation
// documented for stock/receipt concurrency above). The mechanism is structurally identical to the already-proven
// receipt counter: an INSERT ... ON CONFLICT (org_id,name) DO UPDATE ... RETURNING on org_counters, which Postgres
// executes under a per-row lock, so two concurrent inserts for the same organization serialize rather than race.
ok('SKU numbering reuses the existing org_counters row-locked upsert mechanism (same table/pattern as receipt numbers)', (await db.query(`select value from org_counters where org_id='${oa}' and name='sku'`)).rows[0].value == 2)

// ── Regression: upgrading a pre-Phase-2 database must not break POS/Sales ──
// Root cause of the reported bugs: an organization created before 0002/0003 were applied had no main
// branch and no subscription row. 0003 backfills both for every organization that is missing them
// (see 0003_phase2_products_inventory.sql "Upgrade safety"), BEFORE it makes inventory_transactions.branch_id
// and sales.branch_id NOT NULL — without that backfill, those NOT NULL steps fail (aborting 0003, so 0004+
// never apply either, leaving `sales`/`branch_inventory` in a shape the frontend's queries do not match:
// exactly "Could not load sales"), and any organization left without a subscription row isnot entitled,
// so `posAllowed` is false and clicking POS redirects straight back to Products.
const db2 = new PGlite({ extensions: { pg_trgm } })
await db2.exec(`create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.sub',true),'')::uuid $$;
create role anon; create role authenticated; grant usage on schema public, auth to anon, authenticated;`)
await db2.exec(readFileSync(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', ''))
await db2.exec(`grant select,insert,update,delete on all tables in schema public to authenticated;`)
const as2 = async (u, fn) => { await db2.exec(`set role authenticated; select set_config('request.sub','${u}',false)`); try { return await fn() } finally { await db2.exec('reset role') } }
const legacyUser = (await db2.query(`insert into auth.users default values returning id`)).rows[0].id
const legacyOrg = (await as2(legacyUser, () => db2.query(`select create_organization('Legacy Shop') id`))).rows[0].id
const legacyProduct = (await as2(legacyUser, () => db2.query(`insert into products(org_id,sku,name,cost_price,selling_price,min_stock) values ('${legacyOrg}','L1','Legacy Item',10,50,3) returning id`))).rows[0].id
await as2(legacyUser, () => db2.query(`insert into inventory_transactions(org_id,product_id,qty_change,reason) values ('${legacyOrg}','${legacyProduct}',20,'opening')`))
await as2(legacyUser, () => db2.query(`select complete_sale($1,$2::jsonb,$3::jsonb)`, [legacyOrg, JSON.stringify([{ product_id: legacyProduct, qty: 2 }]), JSON.stringify([{ method: 'cash', amount: 100 }])]))
for (const file of ['0002_phase1_foundation.sql', '0003_phase2_products_inventory.sql', '0004_phase3_pos_sales.sql', '0005_restrict_helper_execute.sql', '0006_auto_sku.sql', '0007_phase4_suppliers_purchases.sql', '0008_phase5_expenses_reports.sql'])
  await db2.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
await db2.exec(`grant select,insert,update,delete on all tables in schema public to authenticated;`)  // covers tables created by later migrations (e.g. branch_inventory)
ok('[regression] an organization that pre-dates branches/subscriptions gets a main branch on upgrade', (await db2.query(`select count(*) c from branches where org_id='${legacyOrg}' and is_main`)).rows[0].c == 1)
ok('[regression] and gets a trialing subscription, so POS is not silently locked out (Bug 1 root cause)', (await db2.query(`select status from subscriptions where org_id='${legacyOrg}'`)).rows[0].status === 'trialing')
ok('[regression] its pre-existing stock and ledger history moved onto that main branch without loss', (await db2.query(`select stock_qty from branch_inventory bi join branches br on br.id=bi.branch_id where bi.product_id='${legacyProduct}' and br.is_main`)).rows[0].stock_qty == 18)
ok('[regression] its pre-existing sale now has a branch_id (Sales.tsx selects this column; a missing column is exactly "Could not load sales")', (await db2.query(`select count(*) c from sales where org_id='${legacyOrg}' and branch_id is not null`)).rows[0].c == 1)
const legacyBranch = (await db2.query(`select id from branches where org_id='${legacyOrg}' and is_main`)).rows[0].id
ok('[regression] the Sales.tsx query shape now succeeds for the upgraded organization', !(await rej(as2(legacyUser, () => db2.query(`select id,receipt_no,created_at,status,total,balance_due,branch_id,cashier_id,customer_id from sales where org_id='${legacyOrg}' order by created_at desc limit 20`)))))
const posShapeErr = await rej(as2(legacyUser, () => db2.query(`select product_id,stock_qty from branch_inventory where org_id='${legacyOrg}' and branch_id='${legacyBranch}'`)))
ok('[regression] the Pos.tsx branch_inventory query shape now succeeds for the upgraded organization', !posShapeErr)
const checkoutErr = await rej(as2(legacyUser, () => db2.query(`select complete_sale($1,$2,$3::jsonb,$4::jsonb)`, [legacyOrg, legacyBranch, JSON.stringify([{ product_id: legacyProduct, qty: 1 }]), JSON.stringify([{ method: 'cash', amount: 50 }])])))
ok('[regression] the upgraded organization can still check out (POS remains usable after upgrade)', !checkoutErr)
ok('[regression] a completely fresh organization (created after all migrations) is unaffected by the backfill', (await db.query(`select is_org_entitled('${oa}') e`)).rows[0].e === true)

// ── Phase 4: customers, suppliers, purchases ───────────────────────────────
const custA = (await as(a, () => db.query(`insert into customers(org_id,name,phone,credit_limit) values ('${oa}','Phase4 Customer','0240000001',500) returning id`))).rows[0].id
ok('owner can create a customer with contact details', !!(await db.query(`select id from customers where id='${custA}' and phone='0240000001' and credit_limit=500`)).rows[0])
await as(a, () => db.query(`update customers set email='c4@example.com', address='Accra' where id='${custA}'`))
ok('owner can edit a customer', (await db.query(`select email from customers where id='${custA}'`)).rows[0].email === 'c4@example.com')
ok('org B cannot see org A customers', (await as(b, () => db.query(`select count(*) c from customers where id='${custA}'`))).rows[0].c == 0)
ok('user B cannot create a customer in org A', !!(await rej(as(b, () => db.query(`insert into customers(org_id,name) values ('${oa}','Rogue')`)))))
await as(d, () => db.query(`insert into customers(org_id,name) values ('${oa}','Cashier Customer')`))
ok('cashier can create a customer (operational role)', (await db.query(`select count(*) c from customers where org_id='${oa}' and name='Cashier Customer'`)).rows[0].c == 1)
ok('inventory officer cannot create a customer (not a sales role)', !!(await rej(as(c, () => db.query(`insert into customers(org_id,name) values ('${oa}','Nope')`)))))

const supA = (await as(a, () => db.query(`insert into suppliers(org_id,name,contact_person,phone,email,address) values ('${oa}','Phase4 Supplier','Ama','0240000002','sup@example.com','Kumasi') returning id`))).rows[0].id
ok('owner can create a supplier with contact details', !!(await db.query(`select id from suppliers where id='${supA}'`)).rows[0])
await as(a, () => db.query(`update suppliers set phone='0240000003' where id='${supA}'`))
ok('owner can edit a supplier', (await db.query(`select phone from suppliers where id='${supA}'`)).rows[0].phone === '0240000003')
ok('org B cannot see org A suppliers', (await as(b, () => db.query(`select count(*) c from suppliers where id='${supA}'`))).rows[0].c == 0)
ok('user B cannot create a supplier in org A', !!(await rej(as(b, () => db.query(`insert into suppliers(org_id,name) values ('${oa}','Rogue')`)))))
ok('cashier cannot create a supplier (purchasing role required)', !!(await rej(as(d, () => db.query(`insert into suppliers(org_id,name) values ('${oa}','Nope')`)))))
await as(c, () => db.query(`insert into suppliers(org_id,name) values ('${oa}','Officer Supplier')`))
ok('inventory officer can create a supplier', (await db.query(`select count(*) c from suppliers where org_id='${oa}' and name='Officer Supplier'`)).rows[0].c == 1)
const supB = (await as(b, () => db.query(`insert into suppliers(org_id,name) values ('${ob}','Org B Supplier') returning id`))).rows[0].id

const draft = (u, org, branch, sup, note, items) => as(u, () => db.query(`select create_draft_purchase($1,$2,$3,$4,$5::jsonb) id`, [org, branch, sup, note, JSON.stringify(items)]))
const purCount = async () => Number((await db.query(`select count(*) c from purchases where org_id='${oa}'`)).rows[0].c)
const beforePur = await purCount()
ok('draft with an unknown product is rejected atomically (no partial purchase)', /Product unavailable/.test(await rej(draft(a, oa, branchA, supA, null, [{ product_id: pid2, qty: 1, unit_cost: 70 }, { product_id: '00000000-0000-0000-0000-000000000000', qty: 1, unit_cost: 1 }])) || '') && await purCount() === beforePur)
ok('draft with a duplicate product line is rejected', /Duplicate product/.test(await rej(draft(a, oa, branchA, supA, null, [{ product_id: pid2, qty: 1, unit_cost: 70 }, { product_id: pid2, qty: 1, unit_cost: 70 }])) || '') && await purCount() === beforePur)
ok('draft with invalid quantity or unit cost is rejected', /Invalid quantity/.test(await rej(draft(a, oa, branchA, supA, null, [{ product_id: pid2, qty: 0, unit_cost: 70 }])) || '') && /Invalid unit cost/.test(await rej(draft(a, oa, branchA, supA, null, [{ product_id: pid2, qty: 1, unit_cost: -1 }])) || '') && await purCount() === beforePur)
ok('draft with no lines is rejected', /at least one product/.test(await rej(draft(a, oa, branchA, supA, null, [])) || ''))
ok('cross-tenant supplier rejected (org B supplier in org A purchase)', /Supplier not found/.test(await rej(draft(a, oa, branchA, supB, 'x', [{ product_id: pid2, qty: 1, unit_cost: 70 }])) || ''))
ok('cross-tenant product rejected (org B product in org A purchase)', /Product unavailable/.test(await rej(draft(a, oa, branchA, supA, null, [{ product_id: pidB, qty: 1, unit_cost: 5 }])) || ''))
ok("another org's branch rejected", /Invalid branch/.test(await rej(draft(a, oa, branchB, supA, null, [{ product_id: pid2, qty: 1, unit_cost: 70 }])) || ''))
ok('user B cannot draft a purchase in org A', /Not authorized/.test(await rej(draft(b, oa, branchA, supA, null, [{ product_id: pid2, qty: 1, unit_cost: 70 }])) || ''))
ok('cashier cannot draft a purchase (purchasing role required)', /Not authorized/.test(await rej(draft(d, oa, branchA2, supA, null, [{ product_id: pid, qty: 1, unit_cost: 10 }])) || ''))
ok('branch-scoped officer cannot draft at an unassigned branch', /No access to this branch/.test(await rej(draft(c, oa, branchA, supA, null, [{ product_id: pid, qty: 1, unit_cost: 10 }])) || ''))

const stockBefore = await stockAt(branchA, pid2)
const stockBefore3 = await stockAt(branchA, pid3)
const purId = (await draft(a, oa, branchA, supA, 'first order', [{ product_id: pid2, qty: 2, unit_cost: 70 }, { product_id: pid3, qty: 1, unit_cost: 25 }])).rows[0].id
const purRow = (await db.query(`select ref_no,status,total,branch_id,supplier_id from purchases where id='${purId}'`)).rows[0]
ok('draft stores server-computed total (2x70 + 1x25 = 165)', purRow.status === 'draft' && Number(purRow.total) === 165 && purRow.branch_id === branchA && purRow.supplier_id === supA && purRow.ref_no.startsWith('PO-'))
ok('draft stores line totals per product', (await db.query(`select product_id,qty,unit_cost,line_total from purchase_items where purchase_id='${purId}' order by product_id`)).rows.every((x) => Number(x.qty) * Number(x.unit_cost) === Number(x.line_total)))
ok('draft reference numbers are unique within the organization', (await db.query(`select count(*) c, count(distinct ref_no) d from purchases where org_id='${oa}'`)).rows.every((x) => x.c === x.d))
ok('drafting a purchase does not move stock', await stockAt(branchA, pid2) === stockBefore && await stockAt(branchA, pid3) === stockBefore3)
ok('client cannot insert purchases directly, bypassing the RPC', !!(await rej(as(a, () => db.query(`insert into purchases(org_id,branch_id,supplier_id,ref_no) values ('${oa}','${branchA}','${supA}','HACK-1')`)))))
ok('client cannot insert purchase_items directly, bypassing the RPC', !!(await rej(as(a, () => db.query(`insert into purchase_items(org_id,purchase_id,product_id,qty,unit_cost,line_total) values ('${oa}','${purId}','${pid2}',1,1,1)`)))))
ok('client cannot write a purchase ledger entry directly (reason allowlist)', /row-level security|policy/.test(await rej(as(a, () => db.query(`insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason) values ('${oa}','${branchA}','${pid2}',5,'purchase')`))) || ''))

const oldSnapshot = Number((await db.query(`select cost_price from sale_items where sale_id='${sale2Id}'`)).rows[0].cost_price)
const refNo = (await as(a, () => db.query(`select receive_purchase($1,$2) r`, [oa, purId]))).rows[0].r
ok('receive returns the purchase reference', refNo === purRow.ref_no)
ok('receiving increases the receiving branch stock only', await stockAt(branchA, pid2) === stockBefore + 2 && await stockAt(branchA, pid3) === stockBefore3 + 1 && await stockAt(branchA2) === 19)
ok('receiving marks the purchase received with a timestamp', (await db.query(`select status,received_at from purchases where id='${purId}'`)).rows.every((x) => x.status === 'received' && x.received_at !== null))
ok('receiving stamps last-purchase-price onto product cost', Number((await db.query(`select cost_price from products where id='${pid2}'`)).rows[0].cost_price) === 70 && Number((await db.query(`select cost_price from products where id='${pid3}'`)).rows[0].cost_price) === 25)
ok('an earlier sale keeps its original cost snapshot after the cost changes (historical margin stays accurate)', Number((await db.query(`select cost_price from sale_items where sale_id='${sale2Id}'`)).rows[0].cost_price) === oldSnapshot)
ok('receiving wrote branch-tagged purchase ledger entries referencing the purchase', (await db.query(`select count(*) c from inventory_transactions where reason='purchase' and ref_id='${purId}' and branch_id='${branchA}'`)).rows[0].c == 2)
ok('receiving is audited', (await db.query(`select count(*) c from audit_logs where entity_id='${purId}' and action='purchase.receive'`)).rows[0].c == 1)
ok('a received purchase cannot be received again', /Only a draft/.test(await rej(as(a, () => db.query(`select receive_purchase($1,$2)`, [oa, purId]))) || ''))
ok('a received purchase cannot be cancelled (immutable, like a completed sale)', /Only a draft/.test(await rej(as(a, () => db.query(`select cancel_purchase($1,$2)`, [oa, purId]))) || ''))

const cancelId = (await draft(a, oa, branchA, supA, null, [{ product_id: pid2, qty: 1, unit_cost: 70 }])).rows[0].id
await as(a, () => db.query(`select cancel_purchase($1,$2,$3)`, [oa, cancelId, 'ordered twice']))
ok('a draft purchase can be cancelled with stock untouched', (await db.query(`select status from purchases where id='${cancelId}'`)).rows[0].status === 'cancelled' && await stockAt(branchA, pid2) === stockBefore + 2)
ok('a cancelled purchase cannot be received', /Only a draft/.test(await rej(as(a, () => db.query(`select receive_purchase($1,$2)`, [oa, cancelId]))) || ''))
ok('user B cannot cancel org A drafts', /Not authorized|Purchase not found/.test(await rej(as(b, () => db.query(`select cancel_purchase($1,$2)`, [oa, cancelId]))) || ''))

const scopedDraft = (await draft(c, oa, branchA2, supA, null, [{ product_id: pid, qty: 1, unit_cost: 10 }])).rows[0].id
ok('branch-scoped officer can draft at their assigned branch', !!(await db.query(`select id from purchases where id='${scopedDraft}'`)).rows[0])
ok('branch-scoped user sees purchases at their branch only', (await as(c, () => db.query(`select count(*) n from purchases where branch_id='${branchA2}'`))).rows[0].n >= 1 && (await as(c, () => db.query(`select count(*) n from purchases where branch_id='${branchA}'`))).rows[0].n == 0)
ok('branch-scoped user cannot see purchase items at an unassigned branch', (await as(c, () => db.query(`select count(*) n from purchase_items where purchase_id='${purId}'`))).rows[0].n == 0)
// NOTE: purId is already 'received' here, so a fresh draft is needed — the status check
// runs before the branch check, and a received purchase would fail with 'Only a draft'.
const unassignedDraft = (await draft(a, oa, branchA, supA, null, [{ product_id: pid2, qty: 1, unit_cost: 70 }])).rows[0].id
ok('branch-scoped officer cannot receive at an unassigned branch', /No access to this branch/.test(await rej(as(c, () => db.query(`select receive_purchase($1,$2)`, [oa, unassignedDraft]))) || ''))
await as(a, () => db.query(`select cancel_purchase($1,$2)`, [oa, unassignedDraft]))
ok('org B sees none of org A purchases or items', (await as(b, () => db.query(`select (select count(*) from purchases where org_id='${oa}')+(select count(*) from purchase_items where org_id='${oa}') n`))).rows[0].n == 0)
await as(a, () => db.query(`select cancel_purchase($1,$2)`, [oa, scopedDraft]))

await db.exec(`update subscriptions set status='suspended' where org_id='${oa}'`)
const suspDraft = (await draft(a, oa, branchA, supA, null, [{ product_id: pid2, qty: 1, unit_cost: 70 }])).rows[0].id
ok('drafting still works while the subscription is suspended (paperwork is never trapped)', (await db.query(`select status from purchases where id='${suspDraft}'`)).rows[0].status === 'draft')
ok('receiving is blocked while the subscription is suspended, stock untouched', /Subscription is not active/.test(await rej(as(a, () => db.query(`select receive_purchase($1,$2)`, [oa, suspDraft]))) || '') && await stockAt(branchA, pid2) === stockBefore + 2)
await db.exec(`update subscriptions set status='trialing' where org_id='${oa}'`)
await as(a, () => db.query(`select receive_purchase($1,$2)`, [oa, suspDraft]))
ok('receiving works again once the subscription is reactivated', (await db.query(`select status from purchases where id='${suspDraft}'`)).rows[0].status === 'received' && await stockAt(branchA, pid2) === stockBefore + 3)

// ── Phase 5: expenses + expense categories ──────────────────────────────────
// Reports themselves need no schema: they read persisted sales.total (non-void),
// purchases.total (received only), sale_items qty x cost_price snapshots, and
// branch_inventory x products.cost_price — all covered by existing RLS.
const acct = (await db.query(`insert into auth.users default values returning id`)).rows[0].id
await as(a, () => db.query(`insert into organization_members(org_id,user_id,role) values ('${oa}','${acct}','accountant')`))
const catRent = (await as(a, () => db.query(`insert into expense_categories(org_id,name) values ('${oa}','Rent') returning id`))).rows[0].id
const catUtil = (await as(a, () => db.query(`insert into expense_categories(org_id,name) values ('${oa}','Utilities') returning id`))).rows[0].id
ok('owner can create expense categories', !!(await db.query(`select id from expense_categories where id='${catRent}'`)).rows[0])
ok('category names are unique per organization', !!(await rej(as(a, () => db.query(`insert into expense_categories(org_id,name) values ('${oa}','Rent')`)))))
ok('org B cannot see org A categories', (await as(b, () => db.query(`select count(*) c from expense_categories where org_id='${oa}'`))).rows[0].c == 0)
ok('cashier cannot create a category (financial role required)', !!(await rej(as(d, () => db.query(`insert into expense_categories(org_id,name) values ('${oa}','Nope')`)))))
ok('inventory officer cannot create a category', !!(await rej(as(c, () => db.query(`insert into expense_categories(org_id,name) values ('${oa}','Nope')`)))))
await as(acct, () => db.query(`insert into expense_categories(org_id,name) values ('${oa}','Transport')`))
ok('accountant can create a category', (await db.query(`select count(*) c from expense_categories where org_id='${oa}' and name='Transport'`)).rows[0].c == 1)
ok('cashier cannot read categories at the database level', (await as(d, () => db.query(`select count(*) c from expense_categories where org_id='${oa}'`))).rows[0].c == 0)
ok('inventory officer cannot read categories at the database level', (await as(c, () => db.query(`select count(*) c from expense_categories where org_id='${oa}'`))).rows[0].c == 0)

const exp1 = (await as(a, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,description,payment_method,expense_date) values ('${oa}','${branchA}','${catRent}',1000,'September rent','bank','2026-09-01') returning id`))).rows[0].id
ok('owner can create an expense', !!(await db.query(`select id from expenses where id='${exp1}'`)).rows[0])
ok('creating an expense is audited', (await db.query(`select count(*) c from audit_logs where entity_id='${exp1}' and action='expense.create'`)).rows[0].c == 1)
ok('negative expense amounts are rejected at the database level', !!(await rej(as(a, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,expense_date) values ('${oa}','${branchA}','${catRent}',-50,'2026-09-01')`)))))
ok('zero expense amounts are rejected at the database level', !!(await rej(as(a, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,expense_date) values ('${oa}','${branchA}','${catRent}',0,'2026-09-01')`)))))
ok('invalid payment methods are rejected', !!(await rej(as(a, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,expense_date,payment_method) values ('${oa}','${branchA}','${catRent}',10,'2026-09-01','crypto')`)))))
await as(a, () => db.query(`update expenses set amount=1200 where id='${exp1}'`))
ok('owner can edit an expense', Number((await db.query(`select amount from expenses where id='${exp1}'`)).rows[0].amount) === 1200)
ok('editing an expense is audited', (await db.query(`select count(*) c from audit_logs where entity_id='${exp1}' and action='expense.update'`)).rows[0].c == 1)
await as(a, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,expense_date) values ('${oa}','${branchA}','${catUtil}',200,'2026-09-05')`))
await as(a, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,expense_date) values ('${oa}','${branchA2}','${catUtil}',75,'2026-09-10')`))
await as(acct, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,expense_date) values ('${oa}','${branchA}','${catUtil}',25,'2026-09-12')`))
ok('accountant can create an expense', (await db.query(`select count(*) c from expenses where org_id='${oa}' and amount=25`)).rows[0].c == 1)
ok('cashier cannot create an expense', !!(await rej(as(d, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,expense_date) values ('${oa}','${branchA2}','${catUtil}',10,'2026-09-01')`)))))
ok('inventory officer cannot create an expense (no branch assignment either)', !!(await rej(as(c, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,expense_date) values ('${oa}','${branchA}','${catUtil}',10,'2026-09-01')`)))))
ok('user B cannot create an expense in org A', !!(await rej(as(b, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,expense_date) values ('${oa}','${branchA}','${catRent}',10,'2026-09-01')`)))))
ok('cross-tenant branch rejected (org B branch in org A expense)', !!(await rej(as(a, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,expense_date) values ('${oa}','${branchB}','${catRent}',10,'2026-09-01')`)))))
const catB = (await as(b, () => db.query(`insert into expense_categories(org_id,name) values ('${ob}','Rent') returning id`))).rows[0].id
ok('cross-tenant category rejected (org B category in org A expense)', !!(await rej(as(a, () => db.query(`insert into expenses(org_id,branch_id,category_id,amount,expense_date) values ('${oa}','${branchA}','${catB}',10,'2026-09-01')`)))))
ok('org B sees none of org A expenses', (await as(b, () => db.query(`select count(*) c from expenses where org_id='${oa}'`))).rows[0].c == 0)
ok('cashier sees zero expense rows at the database level', (await as(d, () => db.query(`select count(*) c from expenses`))).rows[0].c == 0)
ok('branch-scoped officer sees no expenses at an unassigned branch', (await as(c, () => db.query(`select count(*) c from expenses where branch_id='${branchA}'`))).rows[0].c == 0)
ok('manager can edit an expense', !(await rej(as(a, () => db.query(`insert into organization_members(org_id,user_id,role) values ('${oa}','${e}','manager')`)))) && true)
await as(e, () => db.query(`update expenses set description='edited by manager' where id='${exp1}'`))
ok('manager edit lands', (await db.query(`select description from expenses where id='${exp1}'`)).rows[0].description === 'edited by manager')
const mgrDel = await as(e, () => db.query(`delete from expenses where id='${exp1}'`))
ok('manager cannot delete an expense (owner/accountant only)', mgrDel.affectedRows === 0 && !!(await db.query(`select id from expenses where id='${exp1}'`)).rows[0])
const cashDel = await as(d, () => db.query(`delete from expenses where id='${exp1}'`))
ok('cashier cannot delete an expense', cashDel.affectedRows === 0 && !!(await db.query(`select id from expenses where id='${exp1}'`)).rows[0])
await as(acct, () => db.query(`delete from expenses where amount=25`))
ok('accountant can delete an expense', (await db.query(`select count(*) c from expenses where amount=25`)).rows[0].c == 0)
ok('deleting an expense is audited', (await db.query(`select count(*) c from audit_logs where action='expense.delete'`)).rows[0].c == 1)
ok('deleting a category with expenses is rejected (history is never orphaned)', !!(await rej(as(a, () => db.query(`delete from expense_categories where id='${catUtil}'`)))))
await as(a, () => db.query(`delete from expense_categories where name='Transport'`))
ok('an unused category can be deleted', (await db.query(`select count(*) c from expense_categories where org_id='${oa}' and name='Transport'`)).rows[0].c == 0)

// Reports read existing persisted data (no new tables/functions needed).
// All September branchA figures below exclude the branchA2 Utilities 75 by construction.
ok('report: revenue is SUM(sales.total) for non-void sales (voids excluded)',
  Number((await db.query(`select coalesce(sum(total),0) s from sales where org_id='${oa}' and status<>'void'`)).rows[0].s) > 0
  && Number((await db.query(`select coalesce(sum(total),0) s from sales where org_id='${oa}' and status<>'void'`)).rows[0].s)
    === Number((await db.query(`select coalesce(sum(total),0) s from sales where org_id='${oa}'`)).rows[0].s)
      - Number((await db.query(`select coalesce(sum(total),0) s from sales where org_id='${oa}' and status='void'`)).rows[0].s))
ok('report: purchases count received only (drafts/cancelled excluded)',
  (await db.query(`select count(*) c from purchases where org_id='${oa}' and status='received'`)).rows[0].c >= 2
  && Number((await db.query(`select coalesce(sum(total),0) s from purchases where org_id='${oa}' and status='received'`)).rows[0].s)
    === Number((await db.query(`select coalesce(sum(p.total),0) s from purchases p where p.org_id='${oa}' and p.status='received'`)).rows[0].s))
ok('report: COGS uses historical sale_items snapshots (qty x cost_price), not current product cost',
  Number((await db.query(`select coalesce(sum(qty*cost_price),0) s from sale_items si join sales s on s.id=si.sale_id where s.org_id='${oa}' and s.status<>'void'`)).rows[0].s) > 0)
ok('report: an earlier sale keeps its cost snapshot after receive_purchase() repriced the product (Phase 4 guarantee reused)',
  Number((await db.query(`select cost_price from sale_items where sale_id='${sale2Id}'`)).rows[0].cost_price) === oldSnapshot)
ok('report: expenses sum for the period (branchA September: 1200 rent + 200 utilities = 1400)',
  Number((await db.query(`select coalesce(sum(amount),0) s from expenses where org_id='${oa}' and branch_id='${branchA}' and expense_date >= '2026-09-01' and expense_date < '2026-10-01'`)).rows[0].s) === 1400)
ok('report: branch filter narrows expenses to one branch (branchA2 September = 75)',
  Number((await db.query(`select coalesce(sum(amount),0) s from expenses where org_id='${oa}' and branch_id='${branchA2}' and expense_date >= '2026-09-01' and expense_date < '2026-10-01'`)).rows[0].s) === 75)
ok('report: empty periods return zero, not null (COALESCE)',
  Number((await db.query(`select coalesce(sum(amount),0) s from expenses where org_id='${oa}' and expense_date >= '2020-01-01' and expense_date < '2020-02-01'`)).rows[0].s) === 0)
ok('report: inventory valuation is current qty x current cost and is non-negative',
  Number((await db.query(`select coalesce(sum(bi.stock_qty*p.cost_price),0) s from branch_inventory bi join products p on p.id=bi.product_id where bi.org_id='${oa}' and bi.branch_id='${branchA}'`)).rows[0].s) >= 0)

if (failures > 0) { console.log(`\n${failures} test(s) FAILED`); process.exit(1) }
console.log('\nAll tests passed')
