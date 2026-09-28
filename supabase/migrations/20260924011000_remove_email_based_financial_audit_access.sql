-- Replace deployed email-based audit read exceptions with current admin role.
-- No wallet or account state is changed.
ALTER TABLE public.transaction_ledger_blocked_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transaction_ledger_blocked_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.transaction_ledger_blocked_attempts TO authenticated;
GRANT SELECT, INSERT ON public.transaction_ledger_blocked_attempts TO service_role;

DROP POLICY IF EXISTS "Admins can read transaction ledger blocked attempts"
  ON public.transaction_ledger_blocked_attempts;
CREATE POLICY "Admins can read transaction ledger blocked attempts"
ON public.transaction_ledger_blocked_attempts
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false) = true
  )
);

ALTER TABLE public.wallet_security_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read wallet security events"
  ON public.wallet_security_events;
CREATE POLICY "Admins can read wallet security events"
ON public.wallet_security_events
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND COALESCE(p.is_admin, false) = true
  )
);
