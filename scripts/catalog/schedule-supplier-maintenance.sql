-- Supabase only. First provision matching SUPPLIER_CATALOG_SECRET Edge secret
-- and supplier_catalog_secret in Vault. Never put that value in source code.
SELECT cron.schedule('supplier-catalog-maintenance','* * * * *',$job$
SELECT net.http_post(
  url:='https://dssvvswvqnxanyzfhixf.supabase.co/functions/v1/supplier-catalog-maintenance',
  headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',decrypted_secret),
  body:='{"action":"refresh"}'::jsonb,
  timeout_milliseconds:=30000
) FROM vault.decrypted_secrets WHERE name='supplier_catalog_secret' LIMIT 1;
$job$);
