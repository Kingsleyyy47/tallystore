-- Defense-in-depth containment for the partner API incident pause.
--
-- The current Edge Function is hard-paused for non-admin actions, and the
-- public Vercel bridge returns PARTNER_API_PAUSED. This migration also disables
-- currently active partners at the data layer so an older deployed function
-- version cannot keep accepting existing API keys after the migration lands.

DO $$
BEGIN
  IF to_regclass('public.api_partners') IS NOT NULL
     AND to_regclass('public.api_partner_logs') IS NOT NULL THEN
    WITH paused AS (
      UPDATE public.api_partners
         SET is_active = false,
             notes = concat_ws(
               E'\n',
               nullif(notes, ''),
               'Paused by 20260919007000_pause_existing_api_partners during wallet security review.'
             ),
             updated_at = now()
       WHERE is_active = true
       RETURNING id
    )
    INSERT INTO public.api_partner_logs (
      partner_id,
      action,
      method,
      status_code,
      success,
      error_message,
      metadata
    )
    SELECT
      id,
      'admin_partner_pause',
      'migration',
      503,
      true,
      'Partner disabled during wallet security review.',
      jsonb_build_object(
        'source', '20260919007000_pause_existing_api_partners',
        'reason', 'wallet_security_review',
        'reactivation_requires_owner_review', true
      )
    FROM paused;
  ELSIF to_regclass('public.api_partners') IS NOT NULL THEN
    UPDATE public.api_partners
       SET is_active = false,
           notes = concat_ws(
             E'\n',
             nullif(notes, ''),
             'Paused by 20260919007000_pause_existing_api_partners during wallet security review.'
           ),
           updated_at = now()
     WHERE is_active = true;
  END IF;
END $$;
