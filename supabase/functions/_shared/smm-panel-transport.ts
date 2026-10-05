// One bounded panel request. The caller owns any one-use paid-send claim.
// This transport never retries, redirects, or logs provider material.
export async function smmPanelRequest<T>(
  url: string,
  apiKey: string,
  params: Record<string, string | number>,
  fetchImpl: typeof fetch = fetch,
  deadlineMs = 20_000,
): Promise<T> {
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 20_000) throw new Error('SMM_PANEL_DEADLINE_INVALID');
  const form = new URLSearchParams();
  form.append('key', apiKey);
  for (const [key, value] of Object.entries(params)) form.append(key, String(value));
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(deadlineMs),
  });
  if (!response.ok) throw new Error('SMM_PANEL_HTTP_ERROR');
  const maxBytes = 1_048_576;
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('SMM_PANEL_RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SMM_PANEL_RESPONSE_UNAVAILABLE');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error('SMM_PANEL_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('SMM_PANEL_RESPONSE_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('SMM_PANEL_RESPONSE_INVALID');
  if ('error' in parsed && parsed.error) throw new Error('SMM_PANEL_REJECTED');
  return parsed as T;
}
