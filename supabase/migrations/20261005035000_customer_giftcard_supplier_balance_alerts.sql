-- Keep supplier warnings redacted and service-only; extend their source allowlist.
-- Does not activate gift-card checkout or change an existing warning.
ALTER TABLE public.supplier_balance_alerts
  DROP CONSTRAINT supplier_balance_alerts_source_check,
  ADD CONSTRAINT supplier_balance_alerts_source_check
    CHECK (source IN ('process-purchase', 'auto-restock', 'manual-restock',
      'customer-airtime', 'customer-giftcards'));
