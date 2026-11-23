import { providerFetch } from "./provider-budget-fetch.ts";

// One request, one bounded response body. Never retry a purchase automatically.
export async function providerHttp(
  url: string | URL,
  init: RequestInit = {},
  fetcher: typeof fetch = providerFetch,
  deadlineMs = 20_000,
) {
  if (
    !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 20_000
  ) throw new Error("SUPPLIER_DEADLINE_INVALID");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let expired = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      controller.abort();
      void reader?.cancel().catch(() => {});
      reject(new Error("SUPPLIER_TIMEOUT"));
    }, deadlineMs);
  });
  const pending = Promise.resolve().then(() =>
    fetcher(url, {
      ...init,
      redirect: "error",
      credentials: "omit",
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent":"TallyStoreIntegration/1.0", ...init.headers },
    })
  );
  void pending.then((response) => {
    if (expired) void response.body?.cancel().catch(() => {});
  }).catch(() => {});
  try {
    const response = await Promise.race([pending, deadline]);
    const max = 4_194_304;
    const advertised = Number(response.headers.get("content-length"));
    if (
      response.redirected || (Number.isFinite(advertised) && advertised > max)
    ) {
      void response.body?.cancel().catch(() => {});
      throw new Error("SUPPLIER_RESPONSE_INVALID");
    }
    reader = response.body?.getReader();
    if (!reader) throw new Error("SUPPLIER_RESPONSE_INVALID");
    let size = 0, text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      for (;;) {
        const part = await Promise.race([reader.read(), deadline]);
        if (part.done) break;
        size += part.value.length;
        if (size > max) throw new Error("SUPPLIER_RESPONSE_INVALID");
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
      reader = undefined;
    }
    if (expired) throw new Error("SUPPLIER_TIMEOUT");
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch { /* Handler APIs intentionally return text. */ }
    return {
      ok: response.ok,
      status: response.status,
      text: text.trim(),
      data,
      headers: response.headers,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
