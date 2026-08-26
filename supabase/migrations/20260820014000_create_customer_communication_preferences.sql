-- Customer communication preferences for permissioned Revenue OS lifecycle actions.
-- Defaults are deliberately conservative: no marketing/lifecycle outreach until
-- the customer opts in.

CREATE TABLE IF NOT EXISTS public.customer_communication_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_lifecycle_opt_in boolean NOT NULL DEFAULT false,
  email_promotions_opt_in boolean NOT NULL DEFAULT false,
  whatsapp_lifecycle_opt_in boolean NOT NULL DEFAULT false,
  push_lifecycle_opt_in boolean NOT NULL DEFAULT false,
  consent_source text NOT NULL DEFAULT 'account_settings',
  consent_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_communication_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own communication preferences" ON public.customer_communication_preferences;
CREATE POLICY "Users can read own communication preferences"
ON public.customer_communication_preferences
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own communication preferences" ON public.customer_communication_preferences;
CREATE POLICY "Users can update own communication preferences"
ON public.customer_communication_preferences
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can modify own communication preferences" ON public.customer_communication_preferences;
CREATE POLICY "Users can modify own communication preferences"
ON public.customer_communication_preferences
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read communication preferences" ON public.customer_communication_preferences;
CREATE POLICY "Admins can read communication preferences"
ON public.customer_communication_preferences
FOR SELECT
USING (public.is_admin_profile());

DROP POLICY IF EXISTS "Admins can manage communication preferences" ON public.customer_communication_preferences;
CREATE POLICY "Admins can manage communication preferences"
ON public.customer_communication_preferences
FOR ALL
USING (public.is_admin_profile())
WITH CHECK (public.is_admin_profile());
