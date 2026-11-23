-- The scheduling token arrives as an RPC parameter, never in committed SQL.
BEGIN;
CREATE FUNCTION public.configure_provider_catalog_auto_sync(p_secret text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE secret_id uuid;job_id bigint;
BEGIN
  IF p_secret IS NULL OR p_secret !~ '^[A-Za-z0-9_-]{40,128}$' THEN RAISE EXCEPTION 'invalid_sync_secret';END IF;
  SELECT id INTO secret_id FROM vault.secrets WHERE name='tallystore_provider_catalog_sync';
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(p_secret,'tallystore_provider_catalog_sync','Provider catalogue refresh authentication');
  ELSE PERFORM vault.update_secret(secret_id,p_secret,'tallystore_provider_catalog_sync','Provider catalogue refresh authentication');END IF;
  SELECT cron.schedule('tallystore-provider-catalog-sync','17 */6 * * *',$cron$
    SELECT net.http_post(
      url:='https://ktmlojvchkmzcdbjdyjx.supabase.co/functions/v1/provider-catalog-sync',
      headers:=jsonb_build_object('Content-Type','application/json','x-provider-catalog-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='tallystore_provider_catalog_sync')),
      body:='{}'::jsonb,timeout_milliseconds:=45000
    );
  $cron$) INTO job_id;
  RETURN jsonb_build_object('success',true,'job_id',job_id,'schedule','17 */6 * * *');
END $$;
REVOKE ALL ON FUNCTION public.configure_provider_catalog_auto_sync(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_provider_catalog_auto_sync(text) TO service_role;
COMMIT;
