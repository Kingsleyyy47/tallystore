import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import {
  KorapayClient,
  settleKoraCheckout,
} from "../_shared/korapay-client.ts";
const serve = Deno.serve;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
serve(async (req) => {
  if (req.method === "OPTIONS") return json({});
  if (req.method !== "POST") {
    return json({ success: false, code: "METHOD_NOT_ALLOWED" }, 405);
  }
  try {
    const origin = Deno.env.get("SUPABASE_URL") || "";
    const auth = createClient(origin, Deno.env.get("SUPABASE_ANON_KEY") || "", {
      auth: { persistSession: false },
    });
    const { data: { user }, error } = await auth.auth.getUser(
      (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""),
    );
    if (error || !user?.email) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    const secret = Deno.env.get("KORAPAY_SECRET_KEY") || "";
    const enabled = !!secret && Deno.env.get("KORAPAY_ENABLED") === "true";
    const body = await req.json();
    if (body.action === "health") {
      return json({ success: true, available: enabled });
    }
    if (!enabled) {
      return json({
        success: false,
        error: "This payment method is unavailable.",
      }, 503);
    }
    const admin = createClient(
      origin,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } },
    );
    const client = new KorapayClient(secret);
    if (body.action === "verify") {
      return json(
        await settleKoraCheckout(
          admin,
          client,
          String(body.reference || ""),
          user.id,
        ),
      );
    }
    if (body.action !== "create") {
      return json({ success: false, error: "Unknown action" }, 400);
    }
    const profile = await admin.from("profiles").select(
      "is_admin,is_staff,account_suspended",
    ).eq("id", user.id).single();
    if (
      profile.error || !profile.data || profile.data.is_admin ||
      profile.data.is_staff || profile.data.account_suspended
    ) return json({ success: false, error: "Customer account required." }, 403);
    const amount = Number(body.amount),
      key = String(body.idempotency_key || "");
    if (
      !Number.isSafeInteger(amount) || amount < 100 || amount > 1_000_000 ||
      !/^[a-zA-Z0-9_-]{10,128}$/.test(key)
    ) {
      return json(
        { success: false, error: "Invalid amount or purchase key." },
        400,
      );
    }
    const site = new URL(Deno.env.get("TALLYSTORE_SITE_ORIGIN") || "");
    if (
      site.protocol !== "https:" || site.username || site.password ||
      site.pathname !== "/"
    ) throw new Error("SITE_CONFIGURATION_REQUIRED");
    const reference = `KORA-${crypto.randomUUID()}`;
    const inserted = await admin.from("korapay_checkouts").upsert({
      user_id: user.id,
      idempotency_key: key,
      amount_ngn: amount,
      reference,
      state: "prepared",
    }, { onConflict: "user_id,idempotency_key", ignoreDuplicates: true });
    if (inserted.error) throw new Error("PAYMENT_EVIDENCE_SAVE_FAILED");
    const saved = await admin.from("korapay_checkouts").select("*").eq(
      "user_id",
      user.id,
    ).eq("idempotency_key", key).single();
    if (
      saved.error || !saved.data || Number(saved.data.amount_ngn) !== amount
    ) {
      return json({
        success: false,
        error: "This key belongs to a different payment.",
      }, 409);
    }
    if (saved.data.checkout_url) {
      return json({
        success: true,
        data: {
          checkoutUrl: saved.data.checkout_url,
          transactionReference: saved.data.reference,
        },
      });
    }
    const claim = await admin.from("korapay_checkouts").update({
      state: "sending",
    }).eq("reference", saved.data.reference).eq("state", "prepared").select(
      "reference",
    ).maybeSingle();
    if (claim.error || !claim.data) {
      return json({
        success: false,
        code: "PAYMENT_REVIEW_REQUIRED",
        error:
          "Payment setup needs confirmation. Check your wallet before starting another payment.",
      }, 202);
    }
    const checkout = await client.initialize({
      amount,
      reference: saved.data.reference,
      email: user.email,
      redirectUrl: `${site.origin}/payment-callback?gateway=korapay`,
      notificationUrl: `${origin}/functions/v1/korapay-webhook`,
    });
    const url = new URL(checkout.checkout_url);
    if (
      url.protocol !== "https:" || url.hostname !== "checkout.korapay.com" ||
      checkout.reference !== saved.data.reference
    ) throw new Error("PAYMENT_UNCONFIRMED");
    const bound = await admin.from("korapay_checkouts").update({
      checkout_url: url.href,
      state: "pending",
    }).eq("reference", saved.data.reference).eq("state", "sending");
    if (bound.error) throw new Error("PAYMENT_UNCONFIRMED");
    return json({
      success: true,
      data: {
        checkoutUrl: url.href,
        transactionReference: saved.data.reference,
      },
    });
  } catch {
    return json({
      success: false,
      error:
        "Payment could not be confirmed. Check your wallet or contact support.",
      code: "PAYMENT_REVIEW_REQUIRED",
    }, 202);
  }
});
