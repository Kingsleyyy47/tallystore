-- Normalize historical debit rows that were inserted with positive amounts.
-- Some legacy admin adjustment writes stored amount = abs(adjustment) while
-- marking the row as admin_debit. The wallet engine signs debits internally;
-- this cleanup makes ledger exports and direct reads match the transaction type.

UPDATE public.transactions
SET
  amount = -abs(amount),
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'sign_normalized_at', now(),
    'sign_normalized_reason', 'debit transaction type must carry negative amount',
    'sign_normalized_from_amount', amount
  )
WHERE amount > 0
  AND lower(COALESCE(type, '')) IN (
    'purchase',
    'admin_debit',
    'staff_debit',
    'debit',
    'withdrawal',
    'chargeback',
    'correction_debit'
  );
