import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { liveSmmCatalogue } from "../_shared/smm-live-catalog.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({});
  if (req.method !== "POST") return json({ success: false }, 405);
  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } },
    );
    const user = await admin.auth.getUser(authorization.slice(7));
    if (user.error || !user.data.user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    const raw = await req.text();
    if (raw.length > 2048) {
      return json({ success: false, error: "Invalid catalogue request" }, 400);
    }
    const body = raw.trim() ? JSON.parse(raw) : {};
    if (typeof body.query !== "undefined" && typeof body.query !== "string") {
      return json({ success: false }, 400);
    }
    const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
    const data = await liveSmmCatalogue(admin, {
      query: String(body.query || "").slice(0, 200),
      platform: String(body.platform || "all").slice(0, 50),
      limit,
    });
    return json({ success: true, data, cache_seconds: 30 });
  } catch {
    return json({
      success: false,
      error: "Live boosting services could not be loaded. Please try again.",
      code: "SMM_CATALOG_UNAVAILABLE",
    }, 503);
  }
});
