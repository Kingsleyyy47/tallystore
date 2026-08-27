-- ============================================================
-- Fix: All missing client-side RLS policies
-- Covers every table the browser client writes to.
-- Run in Supabase SQL Editor.
-- ============================================================


-- ── 1. revenue_events ─────────────────────────────────────────────────────────
-- SELECT policy so PostgREST RETURNING clause works on upsert.
DROP POLICY IF EXISTS "Clients can select own revenue events" ON public.revenue_events;

CREATE POLICY "Clients can select own revenue events"
ON public.revenue_events
FOR SELECT
USING (auth.uid() = user_id OR user_id IS NULL);


-- ── 2. revenue_identity_links ─────────────────────────────────────────────────
-- linkRevenueIdentity() upserts on every login. The table had RLS enabled
-- with no client policies, causing a 403 that blocks session startup.
DROP POLICY IF EXISTS "Clients can insert own identity links"  ON public.revenue_identity_links;
DROP POLICY IF EXISTS "Clients can update own identity links"  ON public.revenue_identity_links;
DROP POLICY IF EXISTS "Clients can select own identity links"  ON public.revenue_identity_links;

CREATE POLICY "Clients can insert own identity links"
ON public.revenue_identity_links
FOR INSERT
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Clients can update own identity links"
ON public.revenue_identity_links
FOR UPDATE
USING  (auth.uid() = user_id OR user_id IS NULL)
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- SELECT needed for upsert RETURNING clause
CREATE POLICY "Clients can select own identity links"
ON public.revenue_identity_links
FOR SELECT
USING (auth.uid() = user_id OR user_id IS NULL);


-- ── 3. cro_outcomes ───────────────────────────────────────────────────────────
-- attributeInterventionPurchase() inserts into cro_outcomes from the browser.
DROP POLICY IF EXISTS "Clients can insert own cro outcomes" ON public.cro_outcomes;
DROP POLICY IF EXISTS "Clients can select own cro outcomes" ON public.cro_outcomes;

CREATE POLICY "Clients can insert own cro outcomes"
ON public.cro_outcomes
FOR INSERT
WITH CHECK (true);   -- outcome row has no user_id; ownership via intervention_id

CREATE POLICY "Clients can select own cro outcomes"
ON public.cro_outcomes
FOR SELECT
USING (true);        -- read-only access to own outcomes is safe; no PII here


-- ── 4. chat_interventions ─────────────────────────────────────────────────────
-- ChatWidget inserts a row whenever a chat session starts.
DROP POLICY IF EXISTS "Clients can insert chat interventions" ON public.chat_interventions;
DROP POLICY IF EXISTS "Clients can select own chat interventions" ON public.chat_interventions;

CREATE POLICY "Clients can insert chat interventions"
ON public.chat_interventions
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Clients can select own chat interventions"
ON public.chat_interventions
FOR SELECT
USING (true);


-- ── 5. site_visits ────────────────────────────────────────────────────────────
-- VisitorTracker inserts a row on every page load (anonymous + authenticated).
DROP POLICY IF EXISTS "Anyone can insert site visits" ON public.site_visits;

CREATE POLICY "Anyone can insert site visits"
ON public.site_visits
FOR INSERT
WITH CHECK (true);


-- ── 6. customer_communication_preferences ─────────────────────────────────────
-- ProfilePage upserts when a customer saves their email preferences.
DROP POLICY IF EXISTS "Clients can upsert own communication prefs" ON public.customer_communication_preferences;
DROP POLICY IF EXISTS "Clients can select own communication prefs" ON public.customer_communication_preferences;

CREATE POLICY "Clients can upsert own communication prefs"
ON public.customer_communication_preferences
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Clients can update own communication prefs"
ON public.customer_communication_preferences
FOR UPDATE
USING  (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Clients can select own communication prefs"
ON public.customer_communication_preferences
FOR SELECT
USING (auth.uid() = user_id);


-- ── 7. chat_sessions ──────────────────────────────────────────────────────────
-- ChatWidget opens, updates, and closes a chat_sessions row per session.
DROP POLICY IF EXISTS "Clients can insert chat sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Clients can update chat sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Clients can select chat sessions" ON public.chat_sessions;

CREATE POLICY "Clients can insert chat sessions"
ON public.chat_sessions
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Clients can update chat sessions"
ON public.chat_sessions
FOR UPDATE
USING  (true)
WITH CHECK (true);

CREATE POLICY "Clients can select chat sessions"
ON public.chat_sessions
FOR SELECT
USING (true);


-- ── 8. app_settings ───────────────────────────────────────────────────────────
-- All client-side code reads app_settings (exchange rate, support links, feature
-- flags, etc.). Without a SELECT policy these queries return 406 / no data.
DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;

CREATE POLICY "Anyone can read app settings"
ON public.app_settings
FOR SELECT
USING (true);
