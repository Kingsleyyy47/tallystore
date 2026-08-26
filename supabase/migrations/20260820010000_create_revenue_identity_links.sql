-- Link anonymous Revenue OS visitors/sessions to authenticated customers.
-- This deliberately avoids IP-based merging; only the browser's own visitor/session
-- identifiers are attached after the customer authenticates.

CREATE TABLE IF NOT EXISTS public.revenue_identity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visitor_id text NOT NULL,
  session_id text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, visitor_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_revenue_identity_links_user_last_seen
ON public.revenue_identity_links(user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_revenue_identity_links_visitor
ON public.revenue_identity_links(visitor_id);

ALTER TABLE public.revenue_identity_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers can link their own revenue identity" ON public.revenue_identity_links;
CREATE POLICY "Customers can link their own revenue identity"
ON public.revenue_identity_links
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Customers can update their own revenue identity" ON public.revenue_identity_links;
CREATE POLICY "Customers can update their own revenue identity"
ON public.revenue_identity_links
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read revenue identity links" ON public.revenue_identity_links;
CREATE POLICY "Admins can read revenue identity links"
ON public.revenue_identity_links
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
  )
);
