import { providerHttp } from "./provider-http.ts";

const BASE = "https://api.korapay.com/merchant/api/v1";
export class KorapayClient {
  constructor(private readonly secret: string) {
    if (!secret) throw new Error("PAYMENT_UNAVAILABLE");
  }
  private async call(path: string, body?: unknown) {
    const result = await providerHttp(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.secret}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!result.ok || result.data?.status !== true) {
      throw new Error("PAYMENT_UNCONFIRMED");
    }
    return result.data.data;
  }
  initialize(
    input: {
      amount: number;
      reference: string;
      email: string;
      redirectUrl: string;
      notificationUrl: string;
    },
  ) {
    return this.call("/charges/initialize", {
      amount: input.amount,
      currency: "NGN",
      reference: input.reference,
      customer: { email: input.email },
      redirect_url: input.redirectUrl,
      notification_url: input.notificationUrl,
      merchant_bears_cost: true,
    });
  }
  verify(reference: string) {
    if (!/^KORA-[a-f0-9-]{36}$/.test(reference)) {
      throw new Error("PAYMENT_REFERENCE_INVALID");
    }
    return this.call(`/charges/${encodeURIComponent(reference)}`);
  }
}
export async function validKoraSignature(
  data: unknown,
  signature: string,
  secret: string,
) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(JSON.stringify(data)),
    ),
  );
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^
      signature.toLowerCase().charCodeAt(i);
  }
  return difference === 0;
}
export async function settleKoraCheckout(
  admin: any,
  client: KorapayClient,
  reference: string,
  userId?: string,
) {
  let query = admin.from("korapay_checkouts").select(
    "user_id,amount_ngn,reference,state",
  ).eq("reference", reference);
  if (userId) query = query.eq("user_id", userId);
  const saved = await query.single();
  if (saved.error || !saved.data) throw new Error("PAYMENT_NOT_FOUND");
  const verified = await client.verify(reference);
  // The signed webhook only initiates verification; amount and owner come from
  // the server-created checkout and the merchant-authenticated verification API.
  if (verified?.status !== "success") {
    return { success: false, status: "pending", error: "Payment is pending." };
  }
  if (
    verified.reference !== reference || verified.currency !== "NGN" ||
    Number(verified.amount) !== Number(saved.data.amount_ngn)
  ) throw new Error("PAYMENT_EVIDENCE_MISMATCH");
  const result = await admin.rpc("settle_korapay_checkout", {
    p_reference: reference,
    p_verified_amount: Number(verified.amount),
    p_currency: verified.currency,
    p_status: verified.status,
  });
  if (result.error || result.data?.success !== true) {
    throw new Error("PAYMENT_CREDIT_UNCONFIRMED");
  }
  return {
    ...result.data,
    amount: Number(saved.data.amount_ngn),
    new_balance: result.data.balance_after,
  };
}
