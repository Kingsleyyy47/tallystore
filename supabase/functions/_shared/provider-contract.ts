// A provider response must explicitly prove rejection before another paid send.
// HTTP failures, malformed replies and timeouts are always outcome-unknown.
export class ProviderDeclined extends Error {
  constructor(
    public readonly code:
      | "NO_NUMBERS"
      | "NO_MONEY"
      | "MAX_PRICE_EXCEEDED"
      | "BAD_KEY"
      | "BAD_SERVICE",
  ) {
    super("Supplier could not accept this request");
  }
}

export function normalizedProductName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

const SMS_ALIASES: Record<string, string> = {
  "twitter x": "twitter",
  "twitter or x": "twitter",
  x: "twitter",
  "apple id": "apple",
  "google gmail": "google",
  "google or gmail": "google",
  "gmail google": "google",
  gmail: "google",
  "tik tok": "tiktok",
  "whats app": "whatsapp",
  "pay pal": "paypal",
  "linked in": "linkedin",
};
export function smsProductName(value: string): string {
  const name = normalizedProductName(value);
  return SMS_ALIASES[name] || name;
}

export type ProductIdentity = {
  kind: "otp" | "rental" | "smm" | "giftcard" | "airtime" | "telegram";
  name: string;
  country?: string;
  currency?: string;
  denomination?: number;
  duration?: string;
  serviceType?: string;
  category?: string;
  refill?: boolean;
  cancel?: boolean;
  network?: string;
};

// Do not strip quality promises, geographic restrictions, speed or refill terms.
// Similar names are suggestions for review, never automatic substitutes.
export function productMatchKey(product: ProductIdentity): string | null {
  const name = product.kind === "otp"
    ? smsProductName(product.name)
    : normalizedProductName(product.name);
  if (!name) return null;
  if (
    (product.kind === "otp" || product.kind === "rental" ||
      product.kind === "airtime" || product.kind === "giftcard") &&
    !product.country
  ) return null;
  if (product.kind === "rental" && !product.duration) return null;
  if (
    product.kind === "giftcard" &&
    (!product.currency || !Number.isFinite(product.denomination))
  ) return null;
  if (
    product.kind === "smm" &&
    (!product.serviceType || !product.category ||
      product.refill === undefined || product.cancel === undefined)
  ) return null;
  return JSON.stringify([
    product.kind,
    name,
    product.country?.toUpperCase() || "",
    product.currency?.toUpperCase() || "",
    product.denomination ?? "",
    product.duration || "",
    normalizedProductName(product.serviceType || ""),
    normalizedProductName(product.category || ""),
    product.refill ?? "",
    product.cancel ?? "",
    product.network || "",
  ]);
}

export async function tryProductFallback<T, R>(
  candidates: readonly T[],
  send: (candidate: T) => Promise<R>,
): Promise<R> {
  let last: ProviderDeclined = new ProviderDeclined("NO_NUMBERS");
  for (const candidate of candidates) {
    try {
      return await send(candidate);
    } catch (error) {
      if (!(error instanceof ProviderDeclined)) throw error;
      // Invalid authentication is an operator issue; never mask it by spending
      // on other accounts. Stock, price and depleted balance are safe declines.
      if (error.code === "BAD_KEY" || error.code === "BAD_SERVICE") throw error;
      last = error;
    }
  }
  throw last;
}
