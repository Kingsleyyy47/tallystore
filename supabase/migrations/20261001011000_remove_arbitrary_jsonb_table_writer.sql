-- This legacy SECURITY DEFINER helper accepted an arbitrary public table,
-- row ID, and JSONB column. Browser roles could use it to modify rows they
-- cannot update directly. No application or database function calls it.
DROP FUNCTION IF EXISTS public.append_jsonb_array(text, uuid, text, jsonb) RESTRICT;
