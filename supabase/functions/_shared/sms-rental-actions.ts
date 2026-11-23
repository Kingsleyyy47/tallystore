import { smsRoutingState } from './sms-provider-policy.ts';
import { providerRead } from "./provider-read-cache.ts";
import { createSmsBusClient, SmsBusApiError } from "./smsbus-client.ts";
import { getNgnUsdRate } from "./exchange-rate.ts";

type Dependencies = {
  assertCustomer: (
    admin: any,
    userId: string,
    req: Request,
    amount: number,
  ) => Promise<void>;
  publicOrder: (order: any) => any;
};
const enabled = () =>
  Deno.env.get("SMS_RENTALS_ENABLED") === "true" &&
  !!Deno.env.get("SMSBUS_API_KEY");
const client = () => createSmsBusClient(Deno.env.get("SMSBUS_API_KEY") || "");
async function fetchRentalAreas(admin: any) {
  if (!enabled()) return [];
  if((await smsRoutingState(admin)).controls.smsbus===false)return [];
  const [{ rate }, areas, setting] = await Promise.all([
    getNgnUsdRate(admin),
    client().listRentalAreas(),
    admin.from("app_settings").select("value").eq(
      "key",
      "sms_rental_monthly_margin_ngn",
    ).maybeSingle(),
  ]);
  const margin = setting.data?.value == null ? 500 : Number(setting.data.value);
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error("RENTAL_PRICING_UNAVAILABLE");
  }
  return areas.filter((row) => row.total > 0 && Number(row.unit_price) > 0).map(
    (row) => ({
      ...row,
      price_ngn_monthly: Math.ceil(
        Number(row.unit_price) / 100 * rate + margin,
      ),
      exchange_rate: rate,
    }),
  );
}
async function wallet(
  admin: any,
  userId: string,
  amount: number,
  reference: string,
  key: string,
  metadata: Record<string, unknown>,
) {
  const result = await admin.rpc("apply_wallet_transaction", {
    p_user_id: userId,
    p_type: "purchase",
    p_amount: amount,
    p_reference: reference,
    p_description: "SMS number rental",
    p_idempotency_key: key,
    p_metadata: metadata,
    p_currency: "NGN",
    p_balance_type: "wallet",
    p_external_payment_id: null,
    p_created_by: null,
  });
  if (
    result.error || result.data?.success !== true ||
    !result.data.transaction?.id ||
    result.data.transaction.reference !== reference
  ) throw new Error("RENTAL_DEBIT_UNCONFIRMED");
  return result.data;
}
async function ownedOrder(admin: any, userId: string, id: unknown) {
  const result = await admin.from("sms_orders").select("*").eq(
    "id",
    String(id || ""),
  ).eq("user_id", userId).eq("order_type", "rental").single();
  if (
    result.error || !result.data ||
    result.data.provider_payload?.rental_supplier !== "smsbus"
  ) throw new Error("RENTAL_NOT_FOUND");
  return result.data;
}
export async function rentalAction(
  admin: any,
  userId: string,
  action: string,
  body: any,
  req: Request,
  deps: Dependencies,
) {
  if (!enabled()) {
    return {
      success: false,
      error: "Long-term rentals are temporarily unavailable.",
    };
  }
  if(['rent_number','renew_rental'].includes(action)&&(await smsRoutingState(admin,undefined,true)).controls.smsbus===false)return {success:false,error:'This rental supplier is disabled.'};
  const provider = client();
  if (action === "rental_sms") {
    const order = await ownedOrder(admin, userId, body.order_id);
    if (order.refunded_at || order.status === "cancelled") {
      throw new Error("RENTAL_INACTIVE");
    }
    const response = body.mode === "history"
      ? await provider.listRentalSms(order.area_code, order.raw_phone_number)
      : await provider.getRentalSms(order.area_code, order.raw_phone_number);
    const rows = Array.isArray(response)
      ? response
      : Array.isArray((response as any)?.list)
      ? (response as any).list
      : [response];
    const messages = [...(Array.isArray(order.messages) ? order.messages : [])];
    for (const row of rows as any[]) {
      if (row?.content) {
        const message = {
          content: String(row.content),
          code: String(row.content).match(/\b\d{4,8}\b/)?.[0] || null,
          received_at: row.receive_at || row.received_at ||
            new Date().toISOString(),
        };
        if (
          !messages.some((existing) =>
            existing.content === message.content &&
            existing.received_at === message.received_at
          )
        ) messages.push(message);
      }
    }
    const saved = await admin.from("sms_orders").update({
      messages,
      updated_at: new Date().toISOString(),
    }).eq("id", order.id).is("refunded_at", null).select("*").single();
    if (saved.error) throw new Error("RENTAL_MESSAGES_SAVE_FAILED");
    return { success: true, data: deps.publicOrder(saved.data) };
  }
  if (action === "cancel_rental") {
    const order = await ownedOrder(admin, userId, body.order_id);
    if (order.refunded_at) {
      return {
        success: true,
        data: deps.publicOrder(order),
        idempotency_hit: true,
      };
    }
    if (
      order.messages?.length ||
      Date.now() - Date.parse(order.created_at) > 20 * 60_000
    ) throw new Error("RENTAL_CANCELLATION_UNAVAILABLE");
    // Renewed numbers have separate paid order receipts. Never refund the
    // original rental while another term is being allocated or has been paid.
    const renewed = await admin.from("sms_rental_operations").select("id").eq(
      "parent_order_id",
      order.id,
    ).limit(1);
    if (renewed.error || renewed.data?.length) {
      throw new Error("RENTAL_RENEWAL_REVIEW_REQUIRED");
    }
    let proof = order.last_provider_response?.sms_cancellation;
    if (!proof) {
      const claim = await admin.rpc("claim_sms_rental_cancel", {
        p_order_id: order.id,
      });
      if (claim.error || claim.data?.send_allowed !== true) {
        throw new Error("RENTAL_CANCELLATION_REVIEW_REQUIRED");
      }
      await provider.cancelRental(String(order.provider_order_id));
      proof = {
        provider: "smsbus",
        activation_id: String(order.provider_request_id),
        provider_response: "ACCESS_CANCEL",
        response: "ACCESS_CANCEL",
        observed_at: new Date().toISOString(),
      };
      const saved = await admin.from("sms_orders").update({
        last_provider_response: {
          ...order.last_provider_response,
          sms_cancellation: proof,
        },
      }).eq("id", order.id);
      if (saved.error) throw new Error("RENTAL_CANCELLATION_REVIEW_REQUIRED");
    }
    const refund = await admin.rpc("cancel_sms_order_and_refund", {
      p_order_id: order.id,
      p_reason: "rental_cancelled",
      p_evidence: proof,
      p_actor_user_id: null,
      p_owner_undelivered_override: false,
    });
    if (refund.error || refund.data?.success !== true) {
      throw new Error("RENTAL_REFUND_REVIEW_REQUIRED");
    }
    return {
      success: true,
      data: deps.publicOrder(await ownedOrder(admin, userId, order.id)),
    };
  }
  const parent = action === "renew_rental"
    ? await ownedOrder(admin, userId, body.order_id)
    : null;
  if (
    parent &&
    (parent.refunded_at || parent.status !== "active" ||
      Date.parse(parent.keep_at) < Date.now())
  ) throw new Error("RENTAL_RENEWAL_UNAVAILABLE");
  const areaCode = String(parent?.area_code || body.area_code || "")
      .toUpperCase(),
    months = Number(body.months),
    key = String(body.idempotency_key || "");
  if (
    !/^[A-Z]{2}$/.test(areaCode) || !Number.isSafeInteger(months) ||
    months < 1 || months > 12 || !/^[A-Za-z0-9_-]{10,160}$/.test(key)
  ) throw new Error("RENTAL_REQUEST_INVALID");
  const prior = await admin.from("sms_rental_operations").select("*").eq(
    "user_id",
    userId,
  ).eq("idempotency_key", key).maybeSingle();
  if (prior.error) throw new Error("RENTAL_REQUEST_UNCONFIRMED");
  if (prior.data) {
    if (
      prior.data.area_code !== areaCode || prior.data.months !== months ||
      String(prior.data.parent_order_id || "") !== String(parent?.id || "")
    ) throw new Error("RENTAL_REQUEST_CONFLICT");
    if (prior.data.state === "bound" && prior.data.order_id) {
      return {
        success: true,
        data: deps.publicOrder(
          await ownedOrder(admin, userId, prior.data.order_id),
        ),
        idempotency_hit: true,
      };
    }
    return {
      success: false,
      code: "SMS_OUTCOME_REVIEW_REQUIRED",
      error:
        "This rental needs confirmation. Check your orders before buying again.",
    };
  }
  const area = (await rentalAreas(admin,true)).find((row) =>
    row.area_code === areaCode
  );
  if (!area || months < Number(area.min_month)) {
    throw new Error("RENTAL_NOT_AVAILABLE");
  }
  const price = area.price_ngn_monthly * months;
  if (Number(body.expected_price_ngn) !== price) {
    throw new Error(
      "Rental price changed. Please refresh and confirm the current price.",
    );
  }
  await deps.assertCustomer(admin, userId, req, price);
  const id = crypto.randomUUID(),
    reference = `SMSR-${id}`,
    orderId = crypto.randomUUID();
  const operation = await admin.from("sms_rental_operations").insert({
    id,
    user_id: userId,
    idempotency_key: key,
    parent_order_id: parent?.id || null,
    area_code: areaCode,
    months,
    amount_ngn: price,
    reference,
    state: "prepared",
    order_id: orderId,
  }).select("id").single();
  if (operation.error) {
    return {
      success: false,
      code: "SMS_OUTCOME_REVIEW_REQUIRED",
      error: "This rental request needs confirmation.",
    };
  }
  let order: any = null;
  let dispatchStarted = false;
  try {
    const debit = await wallet(
      admin,
      userId,
      price,
      reference,
      `sms:rental:${key}`,
      {
        source: "smsbus",
        service_code: `rental-${areaCode}`,
        source_order_id: orderId,
      },
    );
    const inserted = await admin.from("sms_orders").insert({
      id: orderId,
      user_id: userId,
      reference,
      idempotency_key: key,
      order_type: "rental",
      provider: "smsbus",
      service_id: `rental-${areaCode}`,
      service_name: `${area.area_title} number rental`,
      area_code: areaCode,
      country_code: areaCode.toLowerCase(),
      rent_months: months,
      provider_cost_usd: Number(area.unit_price) / 100 * months,
      price_ngn: price,
      exchange_rate: area.exchange_rate,
      total_cost_usd: price / area.exchange_rate,
      margin_usd: (price / area.exchange_rate) -
        (Number(area.unit_price) / 100 * months),
      status: "processing",
      provider_payload: {
        rental_supplier: "smsbus",
        parent_order_id: parent?.id || null,
        pending_provider_allocation: true,
      },
    }).select("*").single();
    if (inserted.error || !inserted.data) {
      throw new Error("RENTAL_ORDER_SAVE_FAILED");
    }
    order = inserted.data;
    const claim = await admin.rpc("claim_sms_rental_dispatch", {
      p_operation_id: id,
    });
    if (claim.error || claim.data?.send_allowed !== true) {
      throw new Error("RENTAL_DISPATCH_UNCONFIRMED");
    }
    dispatchStarted = true;
    const rented = parent
      ? await provider.renewRental(areaCode, parent.raw_phone_number, months)
      : await provider.rentNumber(areaCode, months);
    if (
      !rented?.order_id || !/^\d{7,15}$/.test(String(rented.mobile_number)) ||
      rented.area_code !== areaCode ||
      !/^\d{1,4}$/.test(String(rented.dialing_code)) ||
      !Number.isFinite(Date.parse(rented.expire_at)) ||
      Date.parse(rented.expire_at) <= Date.now() ||
      !Number.isFinite(Date.parse(rented.keep_at)) ||
      Date.parse(rented.keep_at) < Date.parse(rented.expire_at) ||
      (parent &&
        String(rented.mobile_number) !== String(parent.raw_phone_number))
    ) throw new Error("RENTAL_OUTCOME_UNKNOWN");
    const saved = await admin.from("sms_orders").update({
      status: "active",
      provider_order_id: String(rented.order_id),
      provider_request_id: `rental:smsbus:${rented.order_id}`,
      phone_number: `+${rented.dialing_code}${rented.mobile_number}`,
      raw_phone_number: String(rented.mobile_number),
      expires_at: rented.expire_at,
      keep_at: rented.keep_at,
      provider_payload: {
        rental_supplier: "smsbus",
        parent_order_id: parent?.id || null,
        pending_provider_allocation: false,
      },
    }).eq("id", orderId).select("*").single();
    if (saved.error || !saved.data) throw new Error("RENTAL_OUTCOME_UNKNOWN");
    const bound = await admin.from("sms_rental_operations").update({
      state: "bound",
    }).eq("id", id).eq("state", "sending");
    if (bound.error) throw new Error("RENTAL_OUTCOME_UNKNOWN");
    return {
      success: true,
      data: deps.publicOrder(saved.data),
      new_balance: debit.balance_after,
    };
  } catch (error) {
    const definitive = error instanceof SmsBusApiError &&
      [50001, 50002, 50004, 50201, 50401, 50402, 50404].includes(error.code);
    if (order && (!dispatchStarted || definitive)) {
      const evidence = {
        phase: "allocation",
        activation_id: "",
        response: dispatchStarted ? "NO_NUMBERS" : "NOT_REQUESTED",
      };
      const refunded = await admin.rpc("cancel_sms_order_and_refund", {
        p_order_id: order.id,
        p_reason: "rental_allocation_failed",
        p_evidence: evidence,
        p_actor_user_id: null,
        p_owner_undelivered_override: false,
      });
      if (!refunded.error && refunded.data?.success) {
        return {
          success: false,
          code: "SMS_PURCHASE_REFUNDED",
          error: "Rental could not be allocated. Your wallet was refunded.",
        };
      }
    }
    return {
      success: false,
      code: "SMS_OUTCOME_REVIEW_REQUIRED",
      error: "Rental allocation needs review. Do not buy again.",
      data: order ? deps.publicOrder(order) : null,
    };
  }
}

export async function rentalAreas(admin:any,force=false){return force?fetchRentalAreas(admin):providerRead("sms-rental-areas",60_000,()=>fetchRentalAreas(admin))}
