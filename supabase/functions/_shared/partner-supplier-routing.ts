import { routedSmmStatus } from "./smm-provider-router.ts";
import { smsStatus } from "./sms-provider-router.ts";
export async function savePartnerSupplierJournal(
  admin: any,
  orderId: string,
  family: string,
  data: Record<string, unknown>,
) {
  const result = await admin.from("supplier_dispatch_journal").upsert({
    order_id: orderId,
    family,
    data,
    updated_at: new Date().toISOString(),
  }, { onConflict: "order_id" });
  if (result.error) throw new Error("SUPPLIER_JOURNAL_UNCONFIRMED");
}
async function read(admin: any, reference: string, family: string) {
  const id = reference.slice(5);
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    throw new Error("SUPPLIER_REFERENCE_INVALID");
  }
  const result = await admin.from("supplier_dispatch_journal").select("data")
    .eq("order_id", id).eq("family", family).single();
  if (result.error || result.data?.data?.outcome !== "accepted") {
    throw new Error("SUPPLIER_OUTCOME_UNCONFIRMED");
  }
  return result.data.data;
}
export async function partnerRoutedSmmStatus(admin: any, reference: string) {
  const saved = await read(admin, reference, "smm");
  return routedSmmStatus({
    external_order_id: saved.order,
    panel_response: saved,
  });
}
export async function partnerRoutedSmsStatus(admin: any, reference: string) {
  const saved = await read(admin, reference, "sms");
  const result = await smsStatus(saved.activationId,12000,admin);
  return result.status === "ok"
    ? `STATUS_OK:${result.code}`
    : result.status === "waiting"
    ? "STATUS_WAIT_CODE"
    : "STATUS_CANCEL";
}
