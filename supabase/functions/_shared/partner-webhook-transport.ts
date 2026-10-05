import { isPublicIpv4, validatePartnerWebhookUrl, type PinnedWebhookTransport } from './partner-webhook-delivery.ts'

// Raw TLS transport for the delivery helper. Deno.connect receives a checked
// literal IP (no second DNS lookup); startTls verifies the original hostname
// against the certificate and uses that hostname for SNI. Whether the hosted
// Edge runtime permits connect/startTls on port 443 needs a runtime probe.
type Connection = {
  remoteAddr?: { hostname?: string }
  read: (buffer: Uint8Array) => Promise<number | null>
  write: (buffer: Uint8Array) => Promise<number>
  close: () => void
}
export type PinnedDenoRuntime = {
  resolveDns: (hostname: string, type: 'A', options: { signal: AbortSignal }) => Promise<string[]>
  connect: (options: { hostname: string; port: 443; signal: AbortSignal }) => Promise<Connection>
  startTls: (connection: Connection, options: { hostname: string; alpnProtocols: string[] }) => Promise<Connection>
}

const MAX_REQUEST_BYTES = 16_384
const MAX_HEADER_BYTES = 8_192
const ALLOWED_HEADERS = new Set(['content-type', 'user-agent', 'x-tally-event',
  'x-tally-partner-id', 'x-tally-timestamp', 'x-tally-signature'])

function closed(connection: Connection | null) {
  try { connection?.close() } catch { /* Best-effort close after any transport failure. */ }
}
function abortError() { return new Error('webhook transport aborted') }
function requireActive(signal: AbortSignal) { if (signal.aborted) throw abortError() }
async function writeAll(connection: Connection, bytes: Uint8Array, signal: AbortSignal) {
  let offset = 0
  while (offset < bytes.length) {
    requireActive(signal)
    const written = await connection.write(bytes.subarray(offset))
    if (!Number.isSafeInteger(written) || written < 1 || written > bytes.length - offset) throw new Error('webhook write failed')
    offset += written
  }
}
async function readStatusOnly(connection: Connection, signal: AbortSignal): Promise<number> {
  const bytes: number[] = []
  const buffer = new Uint8Array(1024)
  while (bytes.length <= MAX_HEADER_BYTES) {
    requireActive(signal)
    const read = await connection.read(buffer)
    if (read === null || !Number.isSafeInteger(read) || read < 1 || read > buffer.length) throw new Error('webhook response incomplete')
    let complete = false
    for (let index = 0; index < read; index++) {
      bytes.push(buffer[index])
      if (bytes.length > MAX_HEADER_BYTES) throw new Error('webhook response headers too large')
      if (bytes.length >= 4 && bytes.at(-4) === 13 && bytes.at(-3) === 10
        && bytes.at(-2) === 13 && bytes.at(-1) === 10) { complete = true; break }
    }
    if (!complete) continue
    const head = new TextDecoder('latin1').decode(new Uint8Array(bytes.slice(0, -4)))
    const lines = head.split('\r\n')
    const statusMatch = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: [^\r\n]*)?$/.exec(lines[0])
    if (!statusMatch || lines.length > 100 || lines.slice(1).some(line =>
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+:[\t\x20-\x7e]*$/.test(line))) {
      throw new Error('webhook response invalid')
    }
    const status = Number(statusMatch[1])
    if (status < 200) throw new Error('webhook provisional response unsupported')
    // Deliberately do not read or retain any response body. The cap is zero.
    return status
  }
  throw new Error('webhook response headers too large')
}

export function createPinnedDenoWebhookTransport(runtime: PinnedDenoRuntime): PinnedWebhookTransport {
  return {
    async resolveAll(hostname, signal) {
      requireActive(signal)
      // This transport connects only a checked literal IPv4 address. AAAA
      // records cannot be selected by connect or used for a second DNS lookup.
      // The caller rejects every non-public A candidate before the POST.
      const ipv4 = await runtime.resolveDns(hostname, 'A', { signal })
      requireActive(signal)
      if (!Array.isArray(ipv4)) throw new Error('webhook DNS unavailable')
      return ipv4
    },
    async postPinned(request) {
      const target = validatePartnerWebhookUrl(request.url)
      if (!target || target.hostname !== request.hostname || request.method !== 'POST'
        || request.redirect !== 'error' || !Object.isFrozen(request.verifiedIpv4)
        || request.verifiedIpv4.length < 1 || request.verifiedIpv4.some(ip => !isPublicIpv4(ip))) {
        throw new Error('webhook pin invalid')
      }
      const headerEntries = Object.entries(request.headers)
      if (headerEntries.length < 1 || headerEntries.length > ALLOWED_HEADERS.size
        || headerEntries.some(([key, value]) => !ALLOWED_HEADERS.has(key.toLowerCase())
          || !/^[A-Za-z0-9-]+$/.test(key) || typeof value !== 'string'
          || /[\r\n\u0000-\u001f\u007f]/.test(value) || value.length > 1000)) {
        throw new Error('webhook headers invalid')
      }
      const body = new TextEncoder().encode(request.body)
      if (body.length > MAX_REQUEST_BYTES) throw new Error('webhook request too large')
      const url = new URL(target.url)
      const path = `${url.pathname || '/'}${url.search}`
      const head = `POST ${path} HTTP/1.1\r\nHost: ${target.hostname}\r\n`
        + headerEntries.map(([key, value]) => `${key}: ${value}\r\n`).join('')
        + `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n`
      const headerBytes = new TextEncoder().encode(head)
      if (headerBytes.length > MAX_HEADER_BYTES) throw new Error('webhook headers too large')
      const ip = request.verifiedIpv4[0]
      let tcp: Connection | null = null
      let tls: Connection | null = null
      const onAbort = () => { closed(tls); closed(tcp) }
      request.signal.addEventListener('abort', onAbort, { once: true })
      try {
        requireActive(request.signal)
        tcp = await runtime.connect({ hostname: ip, port: 443, signal: request.signal })
        requireActive(request.signal)
        if (tcp.remoteAddr?.hostname && tcp.remoteAddr.hostname !== ip) throw new Error('webhook pin mismatch')
        tls = await runtime.startTls(tcp, { hostname: target.hostname, alpnProtocols: ['http/1.1'] })
        requireActive(request.signal)
        await writeAll(tls, headerBytes, request.signal)
        await writeAll(tls, body, request.signal)
        const status = await readStatusOnly(tls, request.signal)
        return new Response(null, { status })
      } finally {
        request.signal.removeEventListener('abort', onAbort)
        closed(tls)
        closed(tcp)
      }
    },
  }
}

export function createRuntimePinnedWebhookTransport(): PinnedWebhookTransport | null {
  const deno = (globalThis as typeof globalThis & { Deno?: Partial<PinnedDenoRuntime> }).Deno
  if (!deno || typeof deno.resolveDns !== 'function' || typeof deno.connect !== 'function'
    || typeof deno.startTls !== 'function') return null
  return createPinnedDenoWebhookTransport(deno as PinnedDenoRuntime)
}
