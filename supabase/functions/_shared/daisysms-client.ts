// DaisySMS API client (SMS-activate compatible)
// Base URL: https://daisysms.io/stubs/handler_api.php
// Auth: ?api_key=TOKEN in every request
// Responses are plain text, not JSON

export const DAISY_BASE = 'https://daisysms.io/stubs/handler_api.php'
export const DAISY_COUNTRY = 187 // USA in sms-activate API

// ── Human-readable service names ────────────────────────────────────────────
export const SERVICE_NAMES: Record<string, string> = {
  wa: 'WhatsApp', go: 'Google', tg: 'Telegram', ig: 'Instagram',
  fb: 'Facebook', tw: 'Twitter / X', am: 'Amazon', ap: 'Apple ID',
  ms: 'Microsoft', ds: 'Discord', ub: 'Uber', ln: 'LinkedIn',
  yt: 'YouTube', nf: 'Netflix', sn: 'Snapchat', ti: 'TikTok',
  pm: 'PayPal', sh: 'Shopify', eb: 'eBay', cl: 'Craigslist',
  mm: 'Mail.ru', ok: 'Odnoklassniki', vk: 'VKontakte',
  yi: 'Yahoo', wb: 'WeChat', li: 'Line', vi: 'Viber',
  wm: 'Walmart', tk: 'Tokopedia', bd: 'Badoo', gr: 'Grindr',
  oi: 'OkCupid', mb: 'MobiKwik', gg: 'Grab', lf: 'Lyft',
  hz: 'Hinge', bu: 'Bumble', kk: 'KakaoTalk', sk: 'Skype',
  zo: 'Zoom', sp: 'Spotify', rx: 'Robinhood', cb: 'Coinbase',
  bn: 'Binance', kc: 'KuCoin', ft: 'FTX', ex: 'Exness',
  ic: 'ICQ', tt: 'TextNow', pn: 'Plenty of Fish', mt: 'MeetMe',
  zl: 'Zalo', kt: 'Kik', pt: 'Poshmark', of: 'OnlyFans',
}

export class DaisySmsError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'DaisySmsError'
  }
}

// ── Low-level request ────────────────────────────────────────────────────────
async function daisyGet(apiKey: string, params: Record<string, string>): Promise<string> {
  const url = new URL(DAISY_BASE)
  url.searchParams.set('api_key', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), { headers: { Accept: 'text/plain' } })
  const text = (await res.text()).trim()
  return text
}

// ── Balance ──────────────────────────────────────────────────────────────────
export async function getBalance(apiKey: string): Promise<number> {
  const text = await daisyGet(apiKey, { action: 'getBalance' })
  if (text === 'BAD_KEY') throw new DaisySmsError('BAD_KEY', 'Invalid DaisySMS API key')
  // ACCESS_BALANCE:50.30
  const match = text.match(/^ACCESS_BALANCE:([\d.]+)$/)
  if (!match) throw new DaisySmsError('PARSE_ERROR', `Unexpected balance response: ${text}`)
  return parseFloat(match[1])
}

// ── Services list ────────────────────────────────────────────────────────────
export type DaisyService = {
  code: string
  name: string
  count: number
  priceUsd: number
  multipleMessages: boolean
}

export async function getServices(apiKey: string): Promise<DaisyService[]> {
  const text = await daisyGet(apiKey, { action: 'getPricesVerification' })
  if (text === 'BAD_KEY') throw new DaisySmsError('BAD_KEY', 'Invalid DaisySMS API key')

  let raw: Record<string, Record<string, { count: number; price: number; multipleMessages: number }>>
  try {
    raw = JSON.parse(text)
  } catch {
    throw new DaisySmsError('PARSE_ERROR', `Unexpected services response`)
  }

  const services: DaisyService[] = []
  for (const [code, countries] of Object.entries(raw)) {
    const usa = countries[String(DAISY_COUNTRY)]
    if (!usa || Number(usa.count || 0) < 1) continue
    services.push({
      code,
      name: SERVICE_NAMES[code] || code.toUpperCase(),
      count: Number(usa.count || 0),
      priceUsd: Number(usa.price || 0),
      multipleMessages: Number(usa.multipleMessages) === 1,
    })
  }

  // Sort by name
  return services.sort((a, b) => a.name.localeCompare(b.name))
}

// ── Rent a number (OTP) ───────────────────────────────────────────────────────
export type DaisyNumber = {
  activationId: string
  phoneNumber: string
}

export async function getNumber(apiKey: string, serviceCode: string, maxPriceUsd?: number): Promise<DaisyNumber> {
  const params: Record<string, string> = {
    action: 'getNumber',
    service: serviceCode,
  }
  if (maxPriceUsd !== undefined) {
    params.max_price = maxPriceUsd.toFixed(4)
  }

  const text = await daisyGet(apiKey, params)

  if (text === 'NO_NUMBERS') throw new DaisySmsError('NO_NUMBERS', 'No numbers available for this service right now.')
  if (text === 'MAX_PRICE_EXCEEDED') throw new DaisySmsError('MAX_PRICE_EXCEEDED', 'Service price has changed. Please try again.')
  if (text === 'NO_MONEY') throw new DaisySmsError('NO_MONEY', 'SMS purchases are temporarily unavailable.')
  if (text === 'TOO_MANY_ACTIVE_RENTALS') throw new DaisySmsError('TOO_MANY_ACTIVE_RENTALS', 'Too many active SMS rentals. Please cancel one first.')
  if (text === 'BAD_KEY') throw new DaisySmsError('BAD_KEY', 'SMS service is temporarily unavailable.')

  // ACCESS_NUMBER:999999:13476711222
  const match = text.match(/^ACCESS_NUMBER:(\d+):(\d+)$/)
  if (!match) throw new DaisySmsError('PARSE_ERROR', `Unexpected rent response: ${text}`)

  return { activationId: match[1], phoneNumber: match[2] }
}

// ── Check status / get code ───────────────────────────────────────────────────
export type DaisyStatus =
  | { status: 'ok'; code: string }
  | { status: 'waiting' }
  | { status: 'cancelled' }

export async function getStatus(apiKey: string, activationId: string): Promise<DaisyStatus> {
  const text = await daisyGet(apiKey, { action: 'getStatus', id: activationId })

  if (text === 'STATUS_WAIT_CODE') return { status: 'waiting' }
  if (text === 'STATUS_CANCEL') return { status: 'cancelled' }
  if (text === 'NO_ACTIVATION') throw new DaisySmsError('NO_ACTIVATION', 'Activation not found.')

  // STATUS_OK:12345
  const match = text.match(/^STATUS_OK:(.+)$/)
  if (match) return { status: 'ok', code: match[1] }

  throw new DaisySmsError('PARSE_ERROR', `Unexpected status response: ${text}`)
}

// ── Mark as done (status=6) ───────────────────────────────────────────────────
export async function markDone(apiKey: string, activationId: string): Promise<void> {
  await daisyGet(apiKey, { action: 'setStatus', id: activationId, status: '6' })
}

// ── Cancel (status=8) ─────────────────────────────────────────────────────────
export async function cancelNumber(apiKey: string, activationId: string): Promise<boolean> {
  const text = await daisyGet(apiKey, { action: 'setStatus', id: activationId, status: '8' })
  // ACCESS_CANCEL = cancelled OK; ACCESS_READY = already received code, no cancel
  return text === 'ACCESS_CANCEL'
}

// ── Extract OTP code from SMS text ────────────────────────────────────────────
export function extractCode(text: string): string | null {
  // Try common OTP patterns
  const patterns = [
    /\b(\d{4,8})\b/,
    /code[:\s]+(\d{4,8})/i,
    /OTP[:\s]+(\d{4,8})/i,
    /verification[:\s]+(\d{4,8})/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[1]
  }
  return null
}
