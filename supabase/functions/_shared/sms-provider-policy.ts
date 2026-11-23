import { invalidateProviderRead, providerRead } from "./provider-read-cache.ts";
export const SMS_PROVIDER_IDS = [
  "getatext",
  "daisysms_io",
  "daisysms_com",
  "daisysim",
  "herosms",
  "textverify",
  "smsbus",
] as const;
export type SmsRoutingState = {
  controls: Record<string, boolean>;
  metrics: Array<
    {
      provider: string;
      product_key: string;
      accepted: number;
      delivered: number;
      failed: number;
      mean_delivery_ms: number;
      no_stock: number;
      declined: number;
      unknown: number;
      circuit_until?: string;
    }
  >;
};
export const emptySmsRoutingState = (): SmsRoutingState => ({
  controls: {},
  metrics: [],
});
export async function smsRoutingState(
  admin: any,
  product?: string,
  fresh = false,
): Promise<SmsRoutingState> {
  if (typeof admin?.rpc !== "function") return emptySmsRoutingState();
  const read = async () => {
    const query = admin.rpc("get_sms_provider_routing_state", {
      p_product_key: product || null,
    });
    const result =
      await (typeof query.abortSignal === "function"
        ? query.abortSignal(AbortSignal.timeout(3000))
        : query);
    if (
      result.error || !result.data || !result.data.controls ||
      !Array.isArray(result.data.metrics)
    ) throw new Error("SMS_PROVIDER_POLICY_UNAVAILABLE");
    return result.data as SmsRoutingState;
  };
  return fresh
    ? read()
    : providerRead(`sms-policy:${product || "all"}`, 5000, read);
}
export function invalidateSmsPolicy() {
  invalidateProviderRead("sms-policy:");
  invalidateProviderRead("sms-catalogue:");
  invalidateProviderRead("sms-priced-catalog:");
}
export function rankedSmsOffers<T extends { provider: string; price: number }>(
  offers: T[],
  state: SmsRoutingState,
  product: string,
  now = Date.now(),
): T[] {
  const available = offers.filter((offer) =>
    state.controls[offer.provider] !== false
  );
  const cheapest = Math.min(...available.map((offer) => offer.price));
  const score = (offer: T) => {
    const metrics = state.metrics.find((row) =>
      row.provider === offer.provider && row.product_key === product
    );
    const delivered = Number(metrics?.delivered) || 0,
      failed = Number(metrics?.failed) || 0,
      stock = Number(metrics?.no_stock) || 0,
      unknown = Number(metrics?.unknown) || 0;
    const reliability = (delivered + 4) / (delivered + failed + 5);
    const observed = Number(metrics?.mean_delivery_ms);
    const speed = 60000 /
      (60000 +
        (metrics && Number.isFinite(observed) ? Math.max(0, observed) : 60000));
    const availability = 1 -
      (stock + unknown) /
        (stock + unknown + (Number(metrics?.accepted) || 0) + 10);
    const circuit =
      metrics?.circuit_until && Date.parse(metrics.circuit_until) > now
        ? 0.5
        : 0;
    return 0.75 * reliability + 0.2 * speed + 0.05 * availability -
      0.02 * Math.log1p(offer.price / cheapest) - circuit;
  };
  return [...available].sort((a, b) =>
    score(b) - score(a) || a.price - b.price ||
    a.provider.localeCompare(b.provider)
  );
}
export async function recordSmsProviderEvent(
  admin: any,
  provider: string,
  product: string | null,
  kind: string,
  reference?: string,
) {
  if (typeof admin?.rpc !== "function") return;
  try {
    const query = admin.rpc("record_sms_provider_delivery", {
      p_provider: provider,
      p_product_key: product,
      p_kind: kind,
      p_activation_ref: reference || null,
      p_event_id: reference ? null : crypto.randomUUID(),
    });
    await (typeof query.abortSignal === "function"
      ? query.abortSignal(AbortSignal.timeout(1000))
      : query);
  } catch {
    /* Telemetry must never turn a confirmed allocation into an unknown order. */
  }
}
