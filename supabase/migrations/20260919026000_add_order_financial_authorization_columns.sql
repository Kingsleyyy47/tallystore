-- Additive financial-authorization columns for reserve-first route migration.
--
-- These columns let each order table link to the wallet reservation and
-- fulfillment outbox records that authorized paid value release. The migration
-- is intentionally nullable and table-existence guarded so it can run against
-- legacy/staging databases whose optional product-family tables differ.
-- It does not change active route behavior by itself.

DO $$
DECLARE
  target_table text;
  constraint_name text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'orders',
    'smm_orders',
    'sms_orders',
    'telegram_orders',
    'bitrefill_orders',
    'bills_transactions',
    'api_partner_orders'
  ]
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS wallet_reservation_id uuid REFERENCES public.wallet_reservations(id) ON DELETE RESTRICT',
      target_table
    );

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS fulfillment_outbox_id uuid REFERENCES public.fulfillment_dispatch_outbox(id) ON DELETE RESTRICT',
      target_table
    );

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS financial_authorization_status text',
      target_table
    );

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS financial_security_version integer',
      target_table
    );

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS financial_authorization_reference text',
      target_table
    );

    constraint_name := target_table || '_financial_authorization_status_check';
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = constraint_name
        AND conrelid = format('public.%I', target_table)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
          financial_authorization_status IS NULL
          OR financial_authorization_status IN (
            ''legacy_debit'',
            ''authorization_failed'',
            ''reservation_active'',
            ''funds_held'',
            ''dispatch_queued'',
            ''dispatch_claimed'',
            ''captured'',
            ''released'',
            ''outcome_unknown'',
            ''review_required''
          )
        ) NOT VALID',
        target_table,
        constraint_name
      );
    END IF;

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (wallet_reservation_id) WHERE wallet_reservation_id IS NOT NULL',
      'idx_' || target_table || '_wallet_reservation_id',
      target_table
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (fulfillment_outbox_id) WHERE fulfillment_outbox_id IS NOT NULL',
      'idx_' || target_table || '_fulfillment_outbox_id',
      target_table
    );

    EXECUTE format(
      'COMMENT ON COLUMN public.%I.wallet_reservation_id IS %L',
      target_table,
      'Reserve-first authorization record for this order. Nullable for legacy debit-first rows until each route is migrated.'
    );

    EXECUTE format(
      'COMMENT ON COLUMN public.%I.fulfillment_outbox_id IS %L',
      target_table,
      'Durable dispatch message linked to this order. Workers must re-check authorization before supplier delivery.'
    );

    EXECUTE format(
      'COMMENT ON COLUMN public.%I.financial_authorization_status IS %L',
      target_table,
      'Route financial authorization state used during reserve-first migration. It is not customer-editable authority.'
    );
  END LOOP;
END;
$$;
