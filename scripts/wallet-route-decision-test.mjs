const productCatalog = new Map([
  ['prod-a', { price: 4_500, stock: 20, name: 'OLD FB' }],
])

const smmCatalog = new Map([
  ['smm-a', { pricePerUnit: 12, min: 50, max: 5_000, name: 'Followers' }],
])

const smsCatalog = new Map([
  ['sms-a', { price: 1_200, available: 4, enabled: true }],
])

const telegramConfig = {
  minStars: 50,
  maxStars: 1_000_000,
  pricePerStar: 15,
}

class RouteIdempotencyStore {
  constructor() {
    this.orders = new Map()
  }

  get(userId, key) {
    return this.orders.get(`${userId}:${key}`) || null
  }

  set(userId, key, value) {
    this.orders.set(`${userId}:${key}`, value)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function productDecision(store, userId, body) {
  const quantity = Number(body.quantity)
  if (!body.product_group_id || !Number.isInteger(quantity) || quantity < 1) {
    return deny('INVALID_QUANTITY')
  }
  if (quantity > 500) return deny('QUANTITY_LIMIT')
  if (!validIdempotency(body.idempotency_key)) return deny('INVALID_IDEMPOTENCY_KEY')

  const product = productCatalog.get(body.product_group_id)
  if (!product || product.stock < quantity) return deny('PRODUCT_UNAVAILABLE')

  const expected = Number(body.expected_amount_ngn)
  if (!Number.isFinite(expected) || expected <= 0) return deny('EXPECTED_PRICE_REQUIRED')
  const serverAmount = product.price * quantity
  if (Math.abs(expected - serverAmount) > 1) return deny('PRICE_CHANGED')

  const existing = store.get(userId, body.idempotency_key)
  const fingerprint = {
    product_group_id: body.product_group_id,
    quantity,
    amount: serverAmount,
  }
  return idempotentOrCreate(store, userId, body.idempotency_key, fingerprint)
}

function smmDecision(store, userId, body) {
  const service = smmCatalog.get(String(body.service_id || ''))
  if (!service) return deny('SERVICE_UNAVAILABLE')
  const quantity = Number(body.quantity)
  if (!Number.isInteger(quantity) || quantity < 1) return deny('INVALID_QUANTITY')
  if (quantity < service.min) return deny('QUANTITY_BELOW_MINIMUM')
  if (quantity > service.max) return deny('QUANTITY_LIMIT')
  if (!validIdempotency(body.idempotency_key)) return deny('INVALID_IDEMPOTENCY_KEY')

  const expected = Number(body.expected_price_ngn)
  if (!Number.isFinite(expected) || expected <= 0) return deny('EXPECTED_PRICE_REQUIRED')
  const serverAmount = Math.ceil(quantity * service.pricePerUnit)
  if (expected !== serverAmount) return deny('PRICE_CHANGED')

  const fingerprint = {
    service_id: body.service_id,
    quantity,
    amount: serverAmount,
    link: String(body.link || ''),
  }
  return idempotentOrCreate(store, userId, body.idempotency_key, fingerprint)
}

function smsDecision(store, userId, body) {
  const service = smsCatalog.get(String(body.service_id || ''))
  if (!service || !service.enabled || service.available <= 0) return deny('SERVICE_UNAVAILABLE')
  if (!validIdempotency(body.idempotency_key)) return deny('INVALID_IDEMPOTENCY_KEY')
  const expected = Math.round(Number(body.expected_price_ngn))
  if (!Number.isFinite(expected) || expected <= 0) return deny('EXPECTED_PRICE_REQUIRED')
  if (expected !== service.price) return deny('PRICE_CHANGED')

  const fingerprint = {
    service_id: body.service_id,
    amount: service.price,
    order_type: 'otp',
  }
  return idempotentOrCreate(store, userId, body.idempotency_key, fingerprint)
}

function telegramStarsDecision(store, userId, body) {
  const quantity = Number(body.quantity)
  if (!Number.isInteger(quantity) || quantity < telegramConfig.minStars) return deny('INVALID_QUANTITY')
  if (quantity > telegramConfig.maxStars) return deny('QUANTITY_LIMIT')
  if (!validIdempotency(body.idempotency_key)) return deny('INVALID_IDEMPOTENCY_KEY')
  const serverAmount = quantity * telegramConfig.pricePerStar
  const fingerprint = {
    product: 'telegram_stars',
    quantity,
    amount: serverAmount,
    recipient: String(body.recipient || ''),
  }
  return idempotentOrCreate(store, userId, body.idempotency_key, fingerprint)
}

function idempotentOrCreate(store, userId, key, fingerprint) {
  const existing = store.get(userId, key)
  if (existing) {
    if (JSON.stringify(existing.fingerprint) !== JSON.stringify(fingerprint)) {
      return deny('IDEMPOTENCY_REQUEST_CONFLICT', 409)
    }
    return { ok: true, code: 'IDEMPOTENT_REPLAY', amount: existing.fingerprint.amount }
  }
  store.set(userId, key, { fingerprint })
  return { ok: true, code: 'CREATED', amount: fingerprint.amount }
}

function validIdempotency(key) {
  return typeof key === 'string' && key.length >= 10
}

function deny(code, status = 400) {
  return { ok: false, code, status }
}

function walletAuthorizationDecision(walletState, amount) {
  const trustedPrincipal = Number(walletState.trustedPrincipal ?? walletState.trustedAvailable)
  const trustedConsumedSpend = Number(walletState.trustedConsumedSpend ?? 0)
  const reservedSpend = Number(walletState.reservedSpend ?? 0)
  const trustedAvailable = Number(walletState.trustedAvailable ?? (trustedPrincipal - trustedConsumedSpend - reservedSpend))
  const trustedBook = trustedPrincipal - trustedConsumedSpend
  const displayedBalance = Number(walletState.displayedBalance)
  if (
    !Number.isFinite(trustedPrincipal) ||
    !Number.isFinite(trustedConsumedSpend) ||
    !Number.isFinite(reservedSpend) ||
    !Number.isFinite(trustedAvailable) ||
    !Number.isFinite(trustedBook) ||
    !Number.isFinite(displayedBalance)
  ) {
    return deny('FINANCIAL_STATE_UNAVAILABLE', 503)
  }
  if (trustedPrincipal < 0 || trustedConsumedSpend < 0 || reservedSpend < 0 || trustedAvailable < 0) {
    return deny('FINANCIAL_STATE_UNAVAILABLE', 503)
  }
  if (displayedBalance - trustedBook > 1) {
    return { ok: false, code: 'WALLET_UNBACKED_FUNDS', status: 409, freeze: true }
  }
  if (amount > trustedAvailable) {
    return { ok: false, code: 'INSUFFICIENT_FUNDS', status: 402, freeze: false }
  }
  return { ok: true, code: 'AUTHORIZED', freeze: false }
}

function expectCode(result, code, message) {
  assert(result.code === code, `${message}: expected ${code}, got ${result.code}`)
}

function testProductRoute() {
  const store = new RouteIdempotencyStore()
  expectCode(productDecision(store, 'user-a', {
    product_group_id: 'prod-a',
    quantity: -1,
    idempotency_key: 'product-key-1',
    expected_amount_ngn: 4_500,
  }), 'INVALID_QUANTITY', 'product route accepted negative quantity')
  expectCode(productDecision(store, 'user-a', {
    product_group_id: 'prod-a',
    quantity: 501,
    idempotency_key: 'product-key-2',
    expected_amount_ngn: 2_254_500,
  }), 'QUANTITY_LIMIT', 'product route accepted too-large quantity')
  expectCode(productDecision(store, 'user-a', {
    product_group_id: 'prod-a',
    quantity: 2,
    idempotency_key: 'product-key-3',
    expected_amount_ngn: 1,
  }), 'PRICE_CHANGED', 'product route accepted tampered price')
  expectCode(productDecision(store, 'user-a', {
    product_group_id: 'prod-a',
    quantity: 2,
    idempotency_key: 'product-key-4',
    expected_amount_ngn: 9_000,
  }), 'CREATED', 'product route rejected valid purchase')
  expectCode(productDecision(store, 'user-a', {
    product_group_id: 'prod-a',
    quantity: 2,
    idempotency_key: 'product-key-4',
    expected_amount_ngn: 9_000,
  }), 'IDEMPOTENT_REPLAY', 'product route did not replay exact duplicate')
  expectCode(productDecision(store, 'user-a', {
    product_group_id: 'prod-a',
    quantity: 3,
    idempotency_key: 'product-key-4',
    expected_amount_ngn: 13_500,
  }), 'IDEMPOTENCY_REQUEST_CONFLICT', 'product route accepted changed idempotency payload')
}

function testSmmRoute() {
  const store = new RouteIdempotencyStore()
  expectCode(smmDecision(store, 'user-a', {
    service_id: 'smm-a',
    quantity: 49,
    link: 'https://example.com/a',
    idempotency_key: 'smm-key-001',
    expected_price_ngn: 588,
  }), 'QUANTITY_BELOW_MINIMUM', 'SMM route accepted below-minimum quantity')
  expectCode(smmDecision(store, 'user-a', {
    service_id: 'smm-a',
    quantity: 50,
    link: 'https://example.com/a',
    idempotency_key: 'smm-key-002',
    expected_price_ngn: 1,
  }), 'PRICE_CHANGED', 'SMM route accepted tampered price')
  expectCode(smmDecision(store, 'user-a', {
    service_id: 'smm-a',
    quantity: 50,
    link: 'https://example.com/a',
    idempotency_key: 'smm-key-003',
    expected_price_ngn: 600,
  }), 'CREATED', 'SMM route rejected valid purchase')
  expectCode(smmDecision(store, 'user-a', {
    service_id: 'smm-a',
    quantity: 50,
    link: 'https://example.com/b',
    idempotency_key: 'smm-key-003',
    expected_price_ngn: 600,
  }), 'IDEMPOTENCY_REQUEST_CONFLICT', 'SMM route accepted changed link under same key')
}

function testSmsRoute() {
  const store = new RouteIdempotencyStore()
  expectCode(smsDecision(store, 'user-a', {
    service_id: 'sms-a',
    idempotency_key: 'sms-key-001',
    expected_price_ngn: 1,
  }), 'PRICE_CHANGED', 'SMS route accepted tampered price')
  expectCode(smsDecision(store, 'user-a', {
    service_id: 'sms-a',
    idempotency_key: 'sms-key-002',
    expected_price_ngn: 1_200,
  }), 'CREATED', 'SMS route rejected valid purchase')
  expectCode(smsDecision(store, 'user-a', {
    service_id: 'missing',
    idempotency_key: 'sms-key-002',
    expected_price_ngn: 1_200,
  }), 'SERVICE_UNAVAILABLE', 'SMS route accepted missing service before conflict check')
  expectCode(smsDecision(store, 'user-a', {
    service_id: 'sms-a',
    idempotency_key: 'sms-key-002',
    expected_price_ngn: 1_200,
  }), 'IDEMPOTENT_REPLAY', 'SMS route did not replay exact duplicate')
}

function testTelegramRoute() {
  const store = new RouteIdempotencyStore()
  expectCode(telegramStarsDecision(store, 'user-a', {
    quantity: 49,
    recipient: '@buyer',
    idempotency_key: 'telegram-key-1',
    expected_price_ngn: 1,
  }), 'INVALID_QUANTITY', 'Telegram route accepted below-minimum stars')
  const created = telegramStarsDecision(store, 'user-a', {
    quantity: 50,
    recipient: '@buyer',
    idempotency_key: 'telegram-key-2',
    expected_price_ngn: 1,
  })
  expectCode(created, 'CREATED', 'Telegram route rejected valid stars')
  assert(created.amount === 750, 'Telegram route did not use server-computed amount')
  expectCode(telegramStarsDecision(store, 'user-a', {
    quantity: 51,
    recipient: '@buyer',
    idempotency_key: 'telegram-key-2',
    expected_price_ngn: 1,
  }), 'IDEMPOTENCY_REQUEST_CONFLICT', 'Telegram route accepted changed stars under same key')
}

function testWalletAuthorizationDecision() {
  const zeroBalance = walletAuthorizationDecision({ trustedAvailable: 0, displayedBalance: 0 }, 1)
  expectCode(zeroBalance, 'INSUFFICIENT_FUNDS', 'zero trusted balance should be an ordinary decline')
  assert(zeroBalance.freeze === false, 'zero trusted balance ordinary decline must not freeze')

  const lowBalance = walletAuthorizationDecision({ trustedAvailable: 2_000, displayedBalance: 2_000 }, 5_000)
  expectCode(lowBalance, 'INSUFFICIENT_FUNDS', 'low backed balance should be an ordinary decline')
  assert(lowBalance.freeze === false, 'low backed balance ordinary decline must not freeze')

  const validReservation = walletAuthorizationDecision({
    trustedPrincipal: 100_000,
    trustedConsumedSpend: 0,
    reservedSpend: 30_000,
    displayedBalance: 100_000,
  }, 75_000)
  expectCode(validReservation, 'INSUFFICIENT_FUNDS', 'active reservation should reduce available spend')
  assert(validReservation.freeze === false, 'active reservation should not look like unbacked funds')

  const unbackedBalance = walletAuthorizationDecision({ trustedAvailable: 0, displayedBalance: 500_000 }, 1)
  expectCode(unbackedBalance, 'WALLET_UNBACKED_FUNDS', 'displayed balance without backing should be an integrity freeze')
  assert(unbackedBalance.freeze === true, 'unbacked displayed balance must freeze')

  const unavailable = walletAuthorizationDecision({ trustedAvailable: Number.NaN, displayedBalance: 0 }, 1)
  expectCode(unavailable, 'FINANCIAL_STATE_UNAVAILABLE', 'unavailable financial state should fail closed')

  const staleClientAggregate = walletAuthorizationDecision({
    trustedPrincipal: 1_000,
    trustedConsumedSpend: 0,
    reservedSpend: 0,
    trustedAvailable: 1_000,
    displayedBalance: 1_000,
    clientReportedBalance: 100_000,
    cachedAvailableBalance: 100_000,
  }, 5_000)
  expectCode(staleClientAggregate, 'INSUFFICIENT_FUNDS', 'stale client/cache balance must not authorize spend')
  assert(staleClientAggregate.freeze === false, 'stale client/cache balance should be ignored, not treated as evidence')
}

testProductRoute()
testSmmRoute()
testSmsRoute()
testTelegramRoute()
testWalletAuthorizationDecision()

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'hostile negative/out-of-range quantities are denied',
    'tampered client prices are denied in favor of server-computed prices',
    'ordinary insufficient funds decline without fraud freeze',
    'valid reservations reduce available spend without fraud freeze',
    'stale client/cache balances are ignored during authorization',
    'unbacked displayed balances freeze before authorization',
    'unavailable financial state fails closed',
    'exact idempotency replay returns the existing logical order',
    'changed idempotency payloads return IDEMPOTENCY_REQUEST_CONFLICT',
    'Telegram-style pricing ignores client-supplied amount and uses server calculation',
  ],
}, null, 2))
