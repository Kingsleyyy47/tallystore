-- Pending payment rows are trusted payment evidence. They must be created by
-- server-side payment initialization and then consumed by server-side
-- verification only.

DO $$
BEGIN
  IF to_regclass('public.pending_payments') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pending_payments FROM anon, authenticated;

    ALTER TABLE public.pending_payments
      ALTER COLUMN transaction_reference SET NOT NULL,
      ALTER COLUMN amount SET NOT NULL,
      ALTER COLUMN status SET DEFAULT 'pending';

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.pending_payments'::regclass
        AND conname = 'pending_payments_amount_positive'
    ) THEN
      ALTER TABLE public.pending_payments
        ADD CONSTRAINT pending_payments_amount_positive
        CHECK (amount > 0)
        NOT VALID;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.pending_payments'::regclass
        AND conname = 'pending_payments_transaction_reference_not_blank'
    ) THEN
      ALTER TABLE public.pending_payments
        ADD CONSTRAINT pending_payments_transaction_reference_not_blank
        CHECK (length(trim(transaction_reference)) > 0)
        NOT VALID;
    END IF;
  END IF;
END $$;
