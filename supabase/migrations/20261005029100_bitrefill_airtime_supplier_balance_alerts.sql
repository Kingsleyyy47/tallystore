-- Add a redacted Bitrefill airtime operational warning. No provider response,
-- merchant balance, quote cost, recipient or credential is stored here.
-- The existing service-only RPCs and staff-only Edge projection stay unchanged.
ALTER TABLE public.supplier_balance_alerts
  DROP CONSTRAINT supplier_balance_alerts_provider_check,
  ADD CONSTRAINT supplier_balance_alerts_provider_check
    CHECK (provider IN ('muabanvia', 'shopclone', 'shopviaclone', 'bitrefill')),
  DROP CONSTRAINT supplier_balance_alerts_source_check,
  ADD CONSTRAINT supplier_balance_alerts_source_check
    CHECK (source IN ('process-purchase', 'auto-restock', 'manual-restock', 'customer-airtime'));
