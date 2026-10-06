// One request per call. The deadline covers fetch, headers and streamed body.
export async function telegramProviderJson(url: string, init: RequestInit,
  options: { timeoutMs: number; fetcher?: typeof fetch }) {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 25_000) throw new Error('Supplier request failed')
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let expired = false, timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => { if (reader) void reader.cancel().catch(() => {}) }
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
    expired = true; controller.abort(); cancel(); reject(new Error('Supplier request failed'))
  }, options.timeoutMs) })
  const pending = Promise.resolve().then(() => (options.fetcher || fetch)(url, { ...init, signal: controller.signal,
    redirect: 'error', credentials: 'omit', cache: 'no-store' }))
  // A fetch implementation that ignores abort must not retain a late body.
  void pending.then(response => { if (expired && response.body) void response.body.cancel().catch(() => {}) }).catch(() => {})
  try {
    const response = await Promise.race([pending, deadline])
    if (!response.ok || response.redirected) { if (response.body) void response.body.cancel().catch(() => {}); throw new Error('Supplier request failed') }
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1_048_576)) {
      if (response.body) void response.body.cancel().catch(() => {})
      throw new Error('Supplier request failed')
    }
    reader = response.body?.getReader()
    if (!reader) throw new Error('Supplier request failed')
    const chunks: Uint8Array[] = []; let size = 0
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline])
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 1_048_576) throw new Error('Supplier request failed')
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    if (expired) throw new Error('Supplier request failed')
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    catch { throw new Error('Supplier request failed') }
  } catch { throw new Error('Supplier request failed') }
  finally { clearTimeout(timer); cancel(); controller.abort() }
}
