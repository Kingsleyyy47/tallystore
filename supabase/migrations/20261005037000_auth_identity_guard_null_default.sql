-- An unset override is denied. Preserve the existing identity protection,
-- audit schema, trigger, ownership and execution permissions.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
DO $reviewed_guard_fix$
DECLARE
  original text;
  repaired text;
  fingerprint text;
  old_initializer constant text := 'allow_change boolean := current_setting(''app.allow_auth_identity_change'', true) = ''true'';';
  new_initializer constant text := 'allow_change boolean := COALESCE(current_setting(''app.allow_auth_identity_change'', true) = ''true'', false);';
BEGIN
  SELECT pg_get_functiondef('public.block_auth_user_identity_change()'::regprocedure) INTO original;
  fingerprint := encode(sha256(convert_to(original,'UTF8')),'hex');
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='prevent_auth_user_identity_change' AND tgenabled='O' AND tgfoid='public.block_auth_user_identity_change()'::regprocedure) THEN
    RAISE EXCEPTION 'identity_guard_not_enabled';
  END IF;
  IF fingerprint = '95638a7f05dba433cf54e3b10cb8b4e400ee89829069e5e203b4e9e1816922b1' THEN
    RETURN; -- The exact reviewed repair is already installed.
  END IF;
  IF fingerprint <> 'c6348e736b116b821d3c4d61319226a257ddcb17a08a17b3b625e4f5509ff544' THEN
    RAISE EXCEPTION 'identity_guard_review_snapshot_changed';
  END IF;
  repaired := replace(original,old_initializer,new_initializer);
  IF repaired=original OR (length(original)-length(replace(original,old_initializer,'')))/length(old_initializer)<>1 THEN
    RAISE EXCEPTION 'identity_guard_initializer_contract_changed';
  END IF;
  EXECUTE repaired;
  IF pg_get_functiondef('public.block_auth_user_identity_change()'::regprocedure) <> repaired THEN
    RAISE EXCEPTION 'identity_guard_repair_verification_failed';
  END IF;
END;
$reviewed_guard_fix$;
COMMIT;
