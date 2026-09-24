import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readFileSync } from 'fs'
const db = new PGlite({ extensions: { pg_trgm } })
await db.exec(`create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.sub',true),'')::uuid $$;
create role anon; create role authenticated; grant usage on schema public, auth to anon, authenticated;`)
let sql = readFileSync(new URL('../migrations/0001_core.sql', import.meta.url),'utf8').replace('create extension if not exists pgcrypto;','')
await db.exec(sql); await db.exec(`grant select,insert,update,delete on all tables in schema public to authenticated;`)
const ok=(n,c)=>console.log(c?'PASS':'FAIL',n)
const as=async(u,fn)=>{await db.exec(`set role authenticated; select set_config('request.sub','${u}',false)`);try{return await fn()}finally{await db.exec('reset role')}}
const rej=async(p)=>{try{await p;return null}catch(e){return e.message}}
const [a,b]=(await Promise.all([1,2].map(()=>db.query(`insert into auth.users default values returning id`)))).map(r=>r.rows[0].id)
const oa=(await as(a,()=>db.query(`select create_organization('Org A') id`))).rows[0].id
const ob=(await as(b,()=>db.query(`select create_organization('Org B') id`))).rows[0].id
await db.exec(`update organizations set tax_rate=10 where id='${oa}'`)
const pid=(await as(a,async()=>{const r=await db.query(`insert into products(org_id,sku,name,cost_price,selling_price) values ('${oa}','S1','Cement',70,100) returning id`);await db.query(`insert into inventory_transactions(org_id,product_id,qty_change,reason) values ('${oa}','${r.rows[0].id}',5,'opening')`);return r.rows[0].id}))
const stock=async()=>Number((await db.query(`select stock_qty from products where id='${pid}'`)).rows[0].stock_qty)
ok('opening stock via ledger = 5', await stock()===5)
const cust=(await db.query(`insert into customers(org_id,name,credit_limit) values ('${oa}','Kofi',100) returning id`)).rows[0].id
const sale=(items,pays,c=null,d=0)=>as(a,()=>db.query(`select complete_sale($1,$2::jsonb,$3::jsonb,$4,$5) r`,[oa,JSON.stringify(items),JSON.stringify(pays),c,d]))
let r=await sale([{product_id:pid,qty:2}],[{method:'cash',amount:220}])
ok('cash sale returns receipt & total incl. 10% tax', r.rows[0].r.startsWith('R-') && Number((await db.query(`select total from sales`)).rows[0].total)===220)
ok('stock deducted to 3', await stock()===3)
ok('rejects oversell (stock unchanged, no partial sale)', /Insufficient/.test(await rej(sale([{product_id:pid,qty:9}],[{method:'cash',amount:1}]))||'') && await stock()===3 && (await db.query(`select count(*) c from sales`)).rows[0].c==1)
ok('credit sale without customer rejected', /customer/.test(await rej(sale([{product_id:pid,qty:1}],[]))||''))
await sale([{product_id:pid,qty:1}],[{method:'cash',amount:60}],cust)
ok('credit sale raises customer balance by 50', Number((await db.query(`select balance from customers`)).rows[0].balance)===50)
ok('credit limit enforced', /Credit limit/.test(await rej(sale([{product_id:pid,qty:1}],[],cust))||''))
ok('client cannot edit stock directly', /Stock can only/.test(await rej(as(a,()=>db.query(`update products set stock_qty=999 where id='${pid}'`)))||''))
ok('client cannot edit balance directly', /Balance can only/.test(await rej(as(a,()=>db.query(`update customers set balance=0`)))||''))
ok('client cannot insert sales directly', !!(await rej(as(a,()=>db.query(`insert into sales(org_id,receipt_no) values ('${oa}','X')`)))))
ok('user B sees none of A data', (await as(b,()=>db.query(`select (select count(*) from products)+(select count(*) from sales)+(select count(*) from customers) n`))).rows[0].n==0)
ok('user B cannot sell in org A', /Not authorized/.test(await rej(as(b,()=>db.query(`select complete_sale($1,$2::jsonb,'[]'::jsonb)`,[oa,JSON.stringify([{product_id:pid,qty:1}])])))||''))
ok('audit log written', (await db.query(`select count(*) c from audit_logs where action in ('sale.create','product.create')`)).rows[0].c>=3)
