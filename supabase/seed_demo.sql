-- OPTIONAL, DEVELOPMENT ONLY. Never run in production.
-- 1) Sign up in the app and create a business. 2) Replace the id below with your organization id. 3) Run in the SQL editor.
-- Products are organization-wide; stock and minimum stock are per branch, so this seeds the organization's MAIN branch.
do $$ declare o uuid := '00000000-0000-0000-0000-000000000000'; b uuid; c uuid; p record; begin
  select id into b from branches where org_id = o and is_main;
  if b is null then raise exception 'Organization % (or its main branch) not found: replace the id at the top of this script', o; end if;
  insert into categories(org_id,name) values (o,'General') returning id into c;
  insert into products(org_id,category_id,sku,barcode,name,cost_price,selling_price) values
    (o,c,'DEMO-001','6001000000011','Demo Cement 50kg',72,85),(o,c,'DEMO-002','6001000000028','Demo Nails 1kg',12,18),(o,c,'DEMO-003','6001000000035','Demo Paint 4L',95,120);
  for p in select id, sku from products where org_id = o and sku like 'DEMO-%' loop
    -- minimum stock lives on the branch's inventory row; the quantity itself only ever changes through the ledger below
    insert into branch_inventory(org_id,branch_id,product_id,min_stock)
      values (o,b,p.id, case p.sku when 'DEMO-001' then 10 when 'DEMO-002' then 20 else 5 end)
      on conflict (org_id,branch_id,product_id) do update set min_stock = excluded.min_stock;
    insert into inventory_transactions(org_id,branch_id,product_id,qty_change,reason,note) values (o,b,p.id,50,'opening','demo stock');
  end loop;
end $$;
