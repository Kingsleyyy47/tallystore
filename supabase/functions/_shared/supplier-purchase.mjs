import { classifySupplierBalanceFailure, recordSupplierBalanceFailure, resolveSupplierBalanceAlert } from './supplier-balance-alerts.mjs'

const definitions = [
  ['muabanvia', 'muabanvia_product_id', 'MUABANVIA_API_KEY', 'MUABANVIA_BASE_URL', 'https://muabanvia.org/api/buy_product', ['ID', 'id']],
  ['shopclone', 'shopclone_product_id', 'SHOPCLONE_API_KEY', 'SHOPCLONE_BASE_URL', 'https://shopclone.vn/api/buy_product', ['id']],
  ['shopviaclone', 'shopviaclone_product_id', 'SHOPVIACLONE_API_KEY', 'SHOPVIACLONE_BASE_URL', 'https://shopviaclone22.com/api/buy_product', ['id']],
]

const SUPPLIER_RESPONSE_MAX_BYTES = 1_000_000
const SUPPLIER_DEADLINE_MS = 20_000

// Bound the entire paid request, including its body. A Content-Length header is
// only a hint, so count the bytes actually received before decoding or parsing.
export async function readSupplierResponse(fetchImpl, url, options, deadlineMs = SUPPLIER_DEADLINE_MS) {
  const controller = new AbortController()
  let activeReader = null
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      if (activeReader) void activeReader.cancel().catch(() => {})
      reject(new Error('Supplier response deadline exceeded'))
    }, deadlineMs)
  })
  const request = (async () => {
    const response = await fetchImpl(url, {
      ...options,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (response.redirected) throw new Error('Supplier redirected response')
    if (!response.body) throw new Error('Supplier response body missing')
    const reader = response.body.getReader()
    activeReader = reader
    const chunks = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > SUPPLIER_RESPONSE_MAX_BYTES) throw new Error('Supplier response too large')
        chunks.push(value)
      }
    } finally {
      if (activeReader === reader) activeReader = null
      void reader.cancel().catch(() => {})
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { status: response.status, body: JSON.parse(text) }
  })()
  try {
    return await Promise.race([request, deadline])
  } finally {
    controller.abort()
    if (activeReader) void activeReader.cancel().catch(() => {})
    clearTimeout(timer)
  }
}

function normalizeSupplierCredential(item) {
  if (typeof item === 'string') {
    const parts = item.split('|')
    if (parts.length < 2) return null
    // Only the five-column format has documented optional positions. Any
    // additional fields (for example cookies) remain in the exact raw line.
    const documented = parts.length === 5 || (parts.length === 6 && parts[5] === '')
    return {
      username: parts[0],
      password: parts[1],
      email: documented ? parts[2] || null : null,
      email_password: documented ? parts[3] || null : null,
      two_fa_code: documented ? parts[4] || null : null,
      additional_info: { original_line: item },
    }
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  // Keep supplier-defined fields that we do not interpret as part of the
  // delivered credential, including cookies and recovery details.
  return {
    username: item.username || item.user || item.login,
    password: item.password || item.pass,
    email: item.email || null,
    email_password: item.email_password || item.emailPass || null,
    two_fa_code: item.two_fa_code || item.twofa || item['2fa'] || null,
    additional_info: { original_supplier_record: item },
  }
}

export function configuredSuppliers(product, getEnv) {
  return definitions.flatMap(([name, field, keyEnv, urlEnv, defaultUrl, idFields]) => {
    const productId = product[field]
    const apiKey = getEnv(keyEnv)?.trim()
    if (!product.auto_fulfill_enabled || productId == null || !String(productId).trim() || !apiKey) return []
    // Configuration is server-only; also prevent credentials being sent to another host.
    let url
    try { url = new URL(getEnv(urlEnv) || defaultUrl) } catch { return [] }
    if (url.protocol !== 'https:' || url.hostname !== new URL(defaultUrl).hostname || url.username || url.password || url.search || url.hash) return []
    return [{ name, productId: String(productId), apiKey, url: url.href, idFields }]
  })
}

export function normalizeSupplierOutcome(response, status, quantity) {
  // A timeout, server error or unparsable/partial result proves neither delivery nor rejection.
  if (!response || typeof response !== 'object' || Array.isArray(response) || status >= 500 || status === 408 || status === 429) return { outcome: 'unknown' }
  if (status >= 200 && status < 300 && response.status === 'success') {
    if (!Array.isArray(response.data) || response.data.length !== quantity || !response.trans_id || !['string', 'number'].includes(typeof response.trans_id) || String(response.trans_id).length > 200 || !String(response.trans_id).trim()) return { outcome: 'unknown' }
    const credentials = response.data.map(normalizeSupplierCredential)
    const valid = credentials.every(item => item && typeof item.username === 'string' && item.username.trim() && item.username.length <= 4096 && typeof item.password === 'string' && item.password.trim() && item.password.length <= 4096 &&
      ['email', 'email_password', 'two_fa_code'].every(key => item[key] === null || (typeof item[key] === 'string' && item[key].length <= 4096)))
    if (!valid || new Set(credentials.map(item => `${item.username}\u0000${item.password}`)).size !== quantity) return { outcome: 'unknown' }
    return { outcome: 'succeeded', providerReference: String(response.trans_id).trim(), credentials }
  }
  // Only a structured rejection with no delivered accounts permits a paid retry.
  if (!['error', 'failed', 'fail'].includes(response.status) || (Array.isArray(response.data) && response.data.length > 0)) return { outcome: 'unknown' }
  const code = typeof response.code === 'string' ? response.code.toUpperCase() : ''
  const message = String(response.msg || response.message || '').trim()
  const balanceRejected = ['INSUFFICIENT_BALANCE', 'INSUFFICIENT_FUNDS', 'LOW_BALANCE', 'NO_BALANCE', 'NOT_ENOUGH_MONEY'].includes(code) || /^(?:insufficient (?:balance|funds)|not enough (?:money|balance|funds)|balance (?:is )?too low|kh[oô]ng [dđ][uủ] (?:ti[eề]n|s[oố] d[uư])|s[oố] d[uư] kh[oô]ng [dđ][uủ])[.!]?$/iu.test(message)
  if (balanceRejected && classifySupplierBalanceFailure(response, { httpStatus: status })) return { outcome: 'rejected', reason: 'insufficient_balance' }
  if (['NO_STOCK', 'OUT_OF_STOCK', 'INSUFFICIENT_STOCK', 'PRODUCT_NOT_AVAILABLE'].includes(code) || /^(?:out of stock|not enough stock|insufficient stock|no accounts available|s[oố] l[uư][oợ]ng kh[oô]ng [dđ][uủ]|kh[oô]ng [dđ][uủ] s[oố] l[uư][oợ]ng)[.!]?$/iu.test(message)) {
    return { outcome: 'rejected', reason: 'no_stock' }
  }
  return { outcome: 'unknown' }
}

async function rpc(admin, name, args) {
  const { data, error } = await admin.rpc(name, args)
  if (error || !data?.success) throw new Error('Supplier order state could not be verified')
  return data
}

// The journal is the authority for whether a paid call may be sent. A transport
// retry can resume settlement, but can never replay a sending/unknown request.
export async function fulfillSupplierShortfall(admin, { orderId, reservationId, quantity, product, suppliers, idempotencyKey, allowPaidSend = true }, fetchImpl = fetch) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || suppliers.length === 0) return { outcome: 'unavailable' }
  for (const supplier of suppliers) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = await rpc(admin, 'begin_supplier_purchase_attempt', {
        p_order_id: orderId, p_reservation_id: reservationId, p_provider: supplier.name,
        p_product_id: supplier.productId, p_idempotency_key: `${idempotencyKey}:${supplier.name}:${attempt}`,
      })
      if (started.outcome === 'succeeded') {
        const attached = await rpc(admin, 'attach_supplier_purchase_accounts', { p_order_id: orderId, p_attempt_id: started.attempt_id })
        return { outcome: 'succeeded', accountIds: attached.account_ids }
      }
      if (started.outcome === 'unknown' || started.status === 'sending' || started.status === 'unknown') return { outcome: 'unknown' }
      if (started.outcome === 'rejected' || started.status === 'rejected') {
        if (started.reason === 'insufficient_balance') break
        continue
      }
      if (!allowPaidSend) return { outcome: 'unknown' }
      const sending = await rpc(admin, 'mark_supplier_purchase_sending', { p_attempt_id: started.attempt_id })
      if (sending.send_allowed !== true) return { outcome: 'unknown' }
      const form = new FormData()
      form.set('action', 'buyProduct')
      for (const field of supplier.idFields) form.set(field, supplier.productId)
      form.set('amount', String(quantity))
      form.set('api_key', supplier.apiKey)
      const attemptStartedAt = new Date().toISOString()
      let result = { outcome: 'unknown' }
      let raw = null
      let httpStatus
      try {
        const response = await readSupplierResponse(fetchImpl, supplier.url, { method: 'POST', body: form, redirect: 'error' })
        httpStatus = response.status
        raw = response.body
        result = normalizeSupplierOutcome(raw, httpStatus, quantity)
      } catch { /* Preserve unknown; never issue a second paid request. */ }
      await rpc(admin, 'record_supplier_purchase_outcome', {
        p_attempt_id: started.attempt_id, p_outcome: result.outcome,
        p_provider_reference: result.providerReference || null,
        p_credentials: result.credentials || null, p_error: result.reason || null,
      })
      if (result.outcome !== 'succeeded') await recordSupplierBalanceFailure(admin, { provider: supplier.name, productGroupId: product.id, source: 'process-purchase', response: raw, httpStatus })
      if (result.outcome === 'succeeded') {
        const attached = await rpc(admin, 'attach_supplier_purchase_accounts', { p_order_id: orderId, p_attempt_id: started.attempt_id })
        await resolveSupplierBalanceAlert(admin, { provider: supplier.name, attemptStartedAt })
        return { outcome: 'succeeded', accountIds: attached.account_ids }
      }
      if (result.outcome === 'unknown') return { outcome: 'unknown' }
      if (result.reason === 'insufficient_balance') {
        break
      }
    }
  }
  return { outcome: 'exhausted' }
}
