-- Expand the transactions type check constraint to include admin adjustment types.
-- The admin-adjust-balance edge function uses 'admin_credit' and 'admin_debit',
-- but the existing constraint may not include these values.

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_type_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_type_check CHECK (
    type IN (
      'topup',
      'top_up',
      'top-up',
      'wallet_topup',
      'purchase',
      'refund',
      'admin_credit',
      'admin_debit',
      'staff_credit',
      'referral_withdrawal'
    )
  );
