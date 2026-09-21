-- A real provider payment identity must not be able to fund multiple wallet
-- credits just because it arrives through different webhook/event IDs.
--
-- Provider-backed wallet credits should pass external_payment_id into
-- apply_wallet_transaction. Business credits without provider evidence should
-- leave external_payment_id null and remain governed by their own approval
-- evidence and idempotency keys.

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_wallet_funding_external_payment_unique
  ON public.transactions (external_payment_id)
  WHERE external_payment_id IS NOT NULL
    AND length(trim(external_payment_id)) > 0
    AND COALESCE(balance_type, 'wallet') = 'wallet'
    AND type IN (
      'topup',
      'top_up',
      'top-up',
      'wallet_topup',
      'wallet_deposit',
      'deposit'
    );

