-- OPTIONAL, DEVELOPMENT ONLY. Never run in production.
-- 1) Sign up in the app and create a business. 2) Replace the id below with your organization id. 3) Run in the SQL editor.
do $$ declare o uuid := '00000000-0000-0000-0000-000000000000'; c uuid; p uuid; begin
  insert into categories(org_id,name) values (o,'General') returning id into c;
  insert into products(org_id,category_id,sku,barcode,name,cost_price,selling_price,min_stock) values
    (o,c,'DEMO-001','6001000000011','Demo Cement 50kg',72,85,10),(o,c,'DEMO-002','6001000000028','Demo Nails 1kg',12,18,20),(o,c,'DEMO-003','6001000000035','Demo Paint 4L',95,120,5);
  for p in select id from products where org_id = o and sku like 'DEMO-%' loop
    insert into inventory_transactions(org_id,product_id,qty_change,reason,note) values (o,p,50,'opening','demo stock'); end loop;
end $$;
