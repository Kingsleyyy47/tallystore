import {
  configuredSmmProviders,
  syncSmmProviders,
} from "./smm-provider-router.ts";
import { smsCatalogue } from "./sms-provider-router.ts";
import { getNgnUsdRate } from "./exchange-rate.ts";
export async function syncProviderCatalogues(admin: any) {
  const claim = await admin.rpc("claim_provider_catalog_sync");
  if (claim.error) throw new Error("CATALOG_SYNC_UNAVAILABLE");
  if (!claim.data) {
    return { success: true, skipped: true, reason: "already_running" };
  }
  const id = claim.data;
  try {
    const boosting = configuredSmmProviders().length
      ? await syncSmmProviders(admin, (await getNgnUsdRate(admin)).rate)
      : { processed: 0, diagnostics: {} };
    const sms = await smsCatalogue(true, admin, "US");
    const unavailable = [
      ...Object.values(boosting.diagnostics),
      ...Object.values(sms.diagnostics),
    ].some((status) => String(status).startsWith("unavailable"));
    const stats = {
      boosting,
      sms: {
        products: sms.products.length,
        matched: sms.products.filter((product) =>
          product.offers.length > 1
        ).length,
        diagnostics: sms.diagnostics,
      },
    };
    const saved = await admin.rpc("finish_provider_catalog_sync", {
      p_id: id,
      p_status: unavailable ? "partial" : "success",
      p_stats: stats,
    });
    if (saved.error) throw new Error("CATALOG_SYNC_SAVE_UNCONFIRMED");
    return { success: true, partial: unavailable, ...stats };
  } catch (error) {
    await admin.rpc("finish_provider_catalog_sync", {
      p_id: id,
      p_status: "failed",
      p_stats: { code: "CATALOG_SYNC_UNAVAILABLE" },
    });
    throw error;
  }
}
