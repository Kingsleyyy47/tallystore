import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { syncProviderCatalogues } from "../_shared/provider-catalog-sync.ts";
function matches(a: string, b: string) {
  if (!b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return json({ success: false }, 405);
  if (
    !matches(
      req.headers.get("x-provider-catalog-secret") || "",
      Deno.env.get("PROVIDER_CATALOG_SYNC_SECRET") || "",
    )
  ) return json({ success: false, error: "Unauthorized" }, 401);
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } },
    );
    return json(await syncProviderCatalogues(admin));
  } catch {
    return json({
      success: false,
      error: "Catalogue sync failed. Check provider configuration.",
    }, 503);
  }
});
