import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import {
  KorapayClient,
  settleKoraCheckout,
  validKoraSignature,
} from "../_shared/korapay-client.ts";
const serve = Deno.serve;
serve(async (req) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  try {
    const secret = Deno.env.get("KORAPAY_SECRET_KEY") || "";
    const body = await req.json();
    if (
      !await validKoraSignature(
        body?.data,
        req.headers.get("x-korapay-signature") || "",
        secret,
      )
    ) return new Response(null, { status: 401 });
    if (body.event !== "charge.success") {
      return new Response(null, { status: 200 });
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } },
    );
    const result = await settleKoraCheckout(
      admin,
      new KorapayClient(secret),
      String(body.data?.reference || ""),
    );
    return new Response(null, { status: result.success ? 200 : 503 });
  } catch {
    return new Response(null, { status: 503 });
  }
});
