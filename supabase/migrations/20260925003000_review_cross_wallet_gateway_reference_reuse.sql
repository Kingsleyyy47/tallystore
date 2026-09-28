-- A ledger external_payment_id can differ while two wallets claim the same
-- provider reference. Treat this as ambiguous funding at the authorization
-- boundary; preserve both histories for owner/provider investigation.
-- These regular indexes can briefly block writes while built. Measure table
-- size and lock impact in staging before applying to production.
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_gateway_reference_lookup
  ON public.transactions ((NULLIF(btrim(COALESCE(reference, '')), '')))
  WHERE amount > 0
    AND COALESCE(balance_type, 'wallet') = 'wallet'
    AND lower(COALESCE(type, '')) IN
      ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit');

CREATE INDEX IF NOT EXISTS idx_transactions_wallet_gateway_external_lookup
  ON public.transactions ((NULLIF(btrim(COALESCE(external_payment_id, '')), '')))
  WHERE amount > 0
    AND COALESCE(balance_type, 'wallet') = 'wallet'
    AND lower(COALESCE(type, '')) IN
      ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit');

DO $patch$
DECLARE
  v_definition text;
  v_old text := $old$
      SELECT 'pocketfi-evidence:' || (t.metadata->>'webhook_log_id') AS identity
      FROM funding_rows t
      WHERE t.verified_gateway
        AND lower(COALESCE(t.metadata->>'provider', '')) = 'pocketfi'
      GROUP BY t.metadata->>'webhook_log_id'
      HAVING COUNT(DISTINCT t.id) > 1
    ) duplicates$old$;
  v_new text := $new$
      SELECT 'pocketfi-evidence:' || (t.metadata->>'webhook_log_id') AS identity
      FROM funding_rows t
      WHERE t.verified_gateway
        AND lower(COALESCE(t.metadata->>'provider', '')) = 'pocketfi'
      GROUP BY t.metadata->>'webhook_log_id'
      HAVING COUNT(DISTINCT t.id) > 1

      UNION ALL

      SELECT DISTINCT 'cross-wallet-reference:' || t.id::text AS identity
      FROM funding_rows t
      JOIN public.transactions other_credit
        ON other_credit.user_id <> t.user_id
        AND COALESCE(other_credit.balance_type, 'wallet') = 'wallet'
        AND lower(COALESCE(other_credit.type, '')) IN
          ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
        AND lower(COALESCE(other_credit.status, 'completed')) IN
          ('completed', 'success', 'successful', 'credited', 'complete', 'paid', 'finished')
        AND other_credit.amount > 0
        AND other_credit.created_at >= public.wallet_legacy_funding_cutoff()
        AND NULLIF(btrim(COALESCE(other_credit.external_payment_id, '')), '') IS NOT NULL
        AND COALESCE(other_credit.metadata->>'verified_amount_ngn', '') ~
          '^[0-9]+([.][0-9]{1,2})?$'
        AND (other_credit.metadata->>'verified_amount_ngn')::numeric = other_credit.amount
        AND (
          (
            lower(COALESCE(other_credit.metadata->>'provider', '')) IN ('ercas', 'ercaspay')
            AND EXISTS (
              SELECT 1 FROM public.pending_payments other_payment
              WHERE other_payment.user_id = other_credit.user_id
                AND other_payment.amount = other_credit.amount
                AND lower(COALESCE(other_payment.status, 'pending')) = 'credited'
                AND (
                  other_payment.transaction_reference = NULLIF(btrim(COALESCE(other_credit.reference, '')), '')
                  OR other_payment.transaction_reference = NULLIF(btrim(COALESCE(other_credit.external_payment_id, '')), '')
                  OR other_payment.ercas_reference = NULLIF(btrim(COALESCE(other_credit.external_payment_id, '')), '')
                )
            )
          )
          OR (
            lower(COALESCE(other_credit.metadata->>'provider', '')) = 'pocketfi'
            AND COALESCE(other_credit.metadata->>'webhook_log_id', '') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND EXISTS (
              SELECT 1 FROM public.pocketfi_webhook_logs other_log
              WHERE other_log.id = (other_credit.metadata->>'webhook_log_id')::uuid
                AND other_log.matched_user_id = other_credit.user_id
                AND COALESCE(other_log.processed, false)
                AND other_log.verified_amount_ngn = other_credit.amount
                AND NULLIF(btrim(COALESCE(other_log.verified_reference, '')), '') IN (
                  NULLIF(btrim(COALESCE(other_credit.reference, '')), ''),
                  NULLIF(btrim(COALESCE(other_credit.external_payment_id, '')), '')
                )
            )
          )
        )
        AND CASE
          WHEN lower(COALESCE(other_credit.metadata->>'provider', '')) IN ('ercas', 'ercaspay')
            THEN 'ercas'
          ELSE lower(COALESCE(other_credit.metadata->>'provider', ''))
        END = CASE
          WHEN lower(COALESCE(t.metadata->>'provider', '')) IN ('ercas', 'ercaspay')
            THEN 'ercas'
          ELSE lower(COALESCE(t.metadata->>'provider', ''))
        END
        AND (
          NULLIF(btrim(COALESCE(other_credit.reference, '')), '') IN (
            NULLIF(btrim(COALESCE(t.reference, '')), ''),
            NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
          )
          OR NULLIF(btrim(COALESCE(other_credit.external_payment_id, '')), '') IN (
            NULLIF(btrim(COALESCE(t.reference, '')), ''),
            NULLIF(btrim(COALESCE(t.external_payment_id, '')), '')
          )
        )
      WHERE t.verified_gateway
    ) duplicates$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.wallet_financial_truth_internal(uuid)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Unexpected canonical payment-identity calculation';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
END;
$patch$;
