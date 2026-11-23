import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { providerBalances } from "../_shared/provider-balances.ts";
import {
  invalidateSmsPolicy,
  SMS_PROVIDER_IDS,
  smsRoutingState,
} from "../_shared/sms-provider-policy.ts";
import { smsProvidersConfigured } from "../_shared/sms-provider-router.ts";
import { syncProviderCatalogues } from "../_shared/provider-catalog-sync.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({});
  if (req.method !== "POST") return json({ success: false }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 4096) {
      return json({ success: false, error: "Invalid request" }, 400);
    }
    const body = raw.trim() ? JSON.parse(raw) : {},
      action = body.action || "snapshot";
    if (!["snapshot", "toggle_sms", "sync_now"].includes(action)) {
      return json({ success: false, error: "Invalid action" }, 400);
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } },
    );
    const authorization = req.headers.get("Authorization") || "",
      service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    let internal = !!service && authorization === `Bearer ${service}`;
    if (
      !internal && action !== "toggle_sms" &&
      authorization.startsWith("Bearer ")
    ) {
      const token = authorization.slice(7);
      const probe = await fetch(
        `${
          Deno.env.get("SUPABASE_URL")
        }/rest/v1/sms_provider_controls?select=provider&limit=0`,
        {
          headers: { apikey: token, Authorization: authorization },
          redirect: "error",
          signal: AbortSignal.timeout(3000),
        },
      );
      internal = probe.status === 200;
      await probe.body?.cancel();
    }
    let actor: string | null = null, isAdmin = internal;
    if (!internal) {
      const user = await admin.auth.getUser(
        authorization.replace(/^Bearer\s+/i, ""),
      );
      if (user.error || !user.data.user) {
        return json({ success: false, error: "Unauthorized" }, 401);
      }
      actor = user.data.user.id;
      const profile = await admin.from("profiles").select(
        "is_admin,is_staff,account_suspended",
      ).eq("id", actor).single();
      if (
        profile.error || profile.data?.account_suspended ||
        !(profile.data?.is_admin || profile.data?.is_staff)
      ) return json({ success: false, error: "Staff access required" }, 403);
      isAdmin = profile.data.is_admin === true;
    }
    if (action === "toggle_sms") {
      if (
        !actor || typeof body.enabled !== "boolean" ||
        !SMS_PROVIDER_IDS.includes(body.provider)
      ) {
        return json(
          { success: false, error: "Invalid SMS provider control" },
          400,
        );
      }
      if (body.enabled && !smsProvidersConfigured().includes(body.provider)) {
        return json({
          success: false,
          error: "Add this provider API key before enabling it.",
        }, 400);
      }
      const result = await admin.rpc("set_sms_provider_enabled", {
        p_provider: body.provider,
        p_enabled: body.enabled,
        p_actor: actor,
      });
      if (result.error || result.data?.success !== true) {
        throw new Error("PROVIDER_CONTROL_UNCONFIRMED");
      }
      invalidateSmsPolicy();
      return json(result.data);
    }
    if (action === "sync_now") {
      if (!isAdmin) {
        return json({
          success: false,
          error: "Admin access required for catalogue imports",
        }, 403);
      }
      return json(await syncProviderCatalogues(admin));
    }
    const [accounts, state, lastSync] = await Promise.all([
      providerBalances(),
      smsRoutingState(admin, undefined, true),
      admin.from("provider_catalog_sync_runs").select(
        "started_at,finished_at,status,stats",
      ).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const sms = SMS_PROVIDER_IDS.filter(provider=>accounts.some(account=>account.id===provider)).map((provider) => {
      const account = accounts.find((row) => row.id === provider)!;
      const metrics = state.metrics.filter((row) => row.provider === provider);
      const delivered = metrics.reduce(
          (sum, row) => sum + Number(row.delivered),
          0,
        ),
        failed = metrics.reduce((sum, row) => sum + Number(row.failed), 0);
      const mean = delivered
        ? metrics.reduce(
          (sum, row) =>
            sum + Number(row.mean_delivery_ms) * Number(row.delivered),
          0,
        ) / delivered
        : null;
      return {
        id: provider,
        name: account.name,
        configured: account.configured,
        enabled: state.controls[provider] !== false,
        delivered,
        failed,
        mean_delivery_ms: mean,
        success_rate: delivered + failed
          ? delivered / (delivered + failed)
          : null,
      };
    });
    return json({
      success: true,
      accounts,
      sms,
      is_admin: isAdmin,
      balance_cache_seconds: 60,
      last_sync: lastSync.error ? null : lastSync.data,
      auto_sync_schedule: "Every 6 hours",
      routing:
        "Reliability, observed delivery speed and availability per product; price breaks close scores.",
    });
  } catch {
    return json({
      success: false,
      error: "Provider operations could not be loaded. Please refresh.",
    }, 503);
  }
});
