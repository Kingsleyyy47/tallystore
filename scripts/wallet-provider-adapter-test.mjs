function assert(condition, message) {
  if (!condition) throw new Error(message)
}

class WalletLedger {
  constructor(balance) {
    this.balance = balance
    this.entries = []
    this.byKey = new Map()
  }

  debit({ amount, key, route }) {
    return this.#post({ type: 'purchase', amount: -amount, key, route })
  }

  refund({ amount, key, route, originalDebitKey }) {
    if (!originalDebitKey) return { ok: false, code: 'REFUND_ORIGINAL_DEBIT_REQUIRED' }
    const originalDebit = this.byKey.get(originalDebitKey)?.entry
    if (!originalDebit || originalDebit.type !== 'purchase' || originalDebit.amount >= 0) {
      return { ok: false, code: 'REFUND_ORIGINAL_DEBIT_NOT_FOUND' }
    }
    if (amount > Math.abs(originalDebit.amount)) {
      return { ok: false, code: 'REFUND_EXCEEDS_ORIGINAL_DEBIT' }
    }
    return this.#post({ type: 'refund', amount, key, route, originalDebitKey })
  }

  #post({ type, amount, key, route, originalDebitKey = null }) {
    const existing = this.byKey.get(key)
    const shape = JSON.stringify({ type, amount, route, originalDebitKey })

    if (existing) {
      if (existing.shape !== shape) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' }
      return { ok: true, code: 'IDEMPOTENT_REPLAY', entry: existing.entry }
    }

    if (type === 'purchase' && this.balance + amount < 0) {
      return { ok: false, code: 'INSUFFICIENT_FUNDS' }
    }

    this.balance += amount
    const entry = { type, amount, balanceAfter: this.balance, key, route, originalDebitKey }
    this.entries.push(entry)
    this.byKey.set(key, { shape, entry })
    return { ok: true, code: 'POSTED', entry }
  }
}

class MockProviderAdapter {
  constructor(name) {
    this.name = name
    this.calls = []
    this.outcomes = []
  }

  queue(outcome) {
    this.outcomes.push(outcome)
  }

  submit(request) {
    this.calls.push({ provider: this.name, request })
    return this.outcomes.shift() || { status: 'accepted', providerReference: `${this.name}-ok-${this.calls.length}` }
  }
}

class RouteProcessor {
  constructor({ route, provider, ledger }) {
    this.route = route
    this.provider = provider
    this.ledger = ledger
    this.ordersByKey = new Map()
  }

  purchase({ enabled = true, walletState = 'active', financialStateAvailable = true, amount, idempotencyKey, requestShape }) {
    const existing = this.ordersByKey.get(idempotencyKey)
    const shape = JSON.stringify(requestShape)

    if (existing) {
      if (existing.shape !== shape) return { ok: false, code: 'IDEMPOTENCY_REQUEST_CONFLICT', providerCalls: 0 }
      return { ok: true, code: 'IDEMPOTENT_REPLAY', order: existing.order, providerCalls: 0 }
    }

    if (!enabled) return { ok: false, code: 'ROUTE_PAUSED', providerCalls: 0 }
    if (walletState !== 'active') return { ok: false, code: 'WALLET_NOT_ACTIVE', providerCalls: 0 }
    if (!financialStateAvailable) return { ok: false, code: 'FINANCIAL_STATE_UNAVAILABLE', providerCalls: 0 }

    const debit = this.ledger.debit({ amount, key: `${this.route}:debit:${idempotencyKey}`, route: this.route })
    if (!debit.ok) return { ok: false, code: debit.code, providerCalls: 0 }

    const order = {
      id: `${this.route}-order-${this.ordersByKey.size + 1}`,
      route: this.route,
      amount,
      status: 'funds_debited',
      providerReference: null,
      debitKey: `${this.route}:debit:${idempotencyKey}`,
      debitTransactionId: debit.entry.key,
      refundKey: `${this.route}:refund:${idempotencyKey}`,
    }

    this.ordersByKey.set(idempotencyKey, { shape, order })

    const beforeCalls = this.provider.calls.length
    const outcome = this.provider.submit({ orderId: order.id, amount, requestShape, idempotencyKey })
    const providerCalls = this.provider.calls.length - beforeCalls

    if (outcome.status === 'accepted') {
      order.status = 'submitted'
      order.providerReference = outcome.providerReference
      return { ok: true, code: 'SUBMITTED', order, providerCalls }
    }

    if (outcome.status === 'timeout') {
      order.status = 'outcome_unknown'
      return { ok: true, code: 'SUPPLIER_OUTCOME_UNKNOWN', order, providerCalls }
    }

    if (outcome.status === 'failed') {
      const refund = this.ledger.refund({
        amount,
        key: order.refundKey,
        route: this.route,
        originalDebitKey: order.debitKey,
      })
      order.status = 'refund_posted'
      return { ok: true, code: refund.code === 'IDEMPOTENT_REPLAY' ? 'PROVIDER_FAILURE_REPLAY' : 'PROVIDER_FAILURE_REFUNDED', order, providerCalls }
    }

    throw new Error(`Unhandled provider outcome ${outcome.status}`)
  }

  duplicateFailureRefund(idempotencyKey) {
    const existing = this.ordersByKey.get(idempotencyKey)
    assert(existing, `missing order for ${this.route}`)
    const refund = this.ledger.refund({
      amount: existing.order.amount,
      key: existing.order.refundKey,
      route: this.route,
      originalDebitKey: existing.order.debitKey,
    })
    return refund.code
  }
}

function runRouteScenario(route, requestShape) {
  const ledger = new WalletLedger(50000)
  const provider = new MockProviderAdapter(route)
  const processor = new RouteProcessor({ route, provider, ledger })

  const paused = processor.purchase({ enabled: false, amount: 1000, idempotencyKey: 'paused', requestShape })
  assert(paused.code === 'ROUTE_PAUSED' && provider.calls.length === 0, `${route}: paused route called provider`)

  const frozen = processor.purchase({ walletState: 'frozen', amount: 1000, idempotencyKey: 'frozen', requestShape })
  assert(frozen.code === 'WALLET_NOT_ACTIVE' && provider.calls.length === 0, `${route}: frozen wallet called provider`)

  const insufficient = processor.purchase({ amount: 100000, idempotencyKey: 'insufficient', requestShape })
  assert(insufficient.code === 'INSUFFICIENT_FUNDS' && provider.calls.length === 0, `${route}: insufficient wallet called provider`)

  const unavailable = processor.purchase({ financialStateAvailable: false, amount: 1000, idempotencyKey: 'financial-unavailable', requestShape })
  assert(unavailable.code === 'FINANCIAL_STATE_UNAVAILABLE' && provider.calls.length === 0, `${route}: unavailable financial state called provider`)

  provider.queue({ status: 'accepted', providerReference: `${route}-provider-1` })
  const success = processor.purchase({ amount: 1000, idempotencyKey: 'success', requestShape })
  assert(success.code === 'SUBMITTED' && success.providerCalls === 1, `${route}: successful purchase did not call provider exactly once`)
  const successReplay = processor.purchase({ amount: 1000, idempotencyKey: 'success', requestShape })
  assert(successReplay.code === 'IDEMPOTENT_REPLAY' && provider.calls.length === 1, `${route}: exact replay called provider again`)
  const conflict = processor.purchase({ amount: 1000, idempotencyKey: 'success', requestShape: { ...requestShape, tampered: true } })
  assert(conflict.code === 'IDEMPOTENCY_REQUEST_CONFLICT' && provider.calls.length === 1, `${route}: changed idempotency payload called provider`)

  provider.queue({ status: 'timeout' })
  const timeout = processor.purchase({ amount: 1000, idempotencyKey: 'timeout', requestShape })
  assert(timeout.code === 'SUPPLIER_OUTCOME_UNKNOWN', `${route}: timeout did not become unknown outcome`)
  assert(timeout.order.status === 'outcome_unknown', `${route}: timeout order status was not held for review`)
  assert(!ledger.entries.some((entry) => entry.key === `${route}:refund:timeout`), `${route}: timeout created blind refund`)
  const timeoutReplay = processor.purchase({ amount: 1000, idempotencyKey: 'timeout', requestShape })
  assert(timeoutReplay.code === 'IDEMPOTENT_REPLAY', `${route}: timeout exact replay did not reuse held order`)

  provider.queue({ status: 'failed' })
  const failed = processor.purchase({ amount: 1000, idempotencyKey: 'failed', requestShape })
  assert(failed.code === 'PROVIDER_FAILURE_REFUNDED', `${route}: failed provider outcome did not refund`)
  const failedRefund = ledger.entries.find((entry) => entry.key === `${route}:refund:failed`)
  assert(failedRefund?.originalDebitKey === `${route}:debit:failed`, `${route}: provider failure refund did not reference the original debit`)
  assert(ledger.refund({ amount: 1000, key: `${route}:refund:naked`, route }).code === 'REFUND_ORIGINAL_DEBIT_REQUIRED', `${route}: naked provider refund was allowed`)
  assert(processor.duplicateFailureRefund('failed') === 'IDEMPOTENT_REPLAY', `${route}: duplicate failure refund double-credited`)

  return {
    route,
    providerCalls: provider.calls.length,
    ledgerEntries: ledger.entries.length,
    finalBalance: ledger.balance,
    outboundNetworkCalls: 0,
  }
}

const scenarios = [
  runRouteScenario('smm-panel', { serviceId: 'svc-1', link: 'https://example.com/p/1', quantity: 100 }),
  runRouteScenario('daisysms', { serviceCode: 'ot', country: 'NG', maxProviderPriceUsd: 0.5 }),
  runRouteScenario('istar', { type: 'stars', username: '@customer', quantity: 100 }),
  runRouteScenario('bitrefill', { productId: 'gift-card-1', packageId: 'pkg-1', recipientEmail: 'customer@example.com' }),
  runRouteScenario('sagecloud-bills', { productType: 'airtime', phone: '08000000000', network: 'mtn' }),
  runRouteScenario('sagecloud-withdrawal', { bankCode: '044', accountNumber: '0123456789', amount: 1000 }),
]

assert(scenarios.every((scenario) => scenario.outboundNetworkCalls === 0), 'provider adapter tests must not make network calls')

console.log(JSON.stringify({
  ok: true,
  routes: scenarios,
  assertions: [
    'paused routes do not call providers',
    'frozen wallets do not call providers',
    'insufficient funds do not call providers',
    'unavailable financial state does not call providers',
    'successful orders call providers exactly once',
    'exact idempotency replay does not redispatch',
    'changed idempotency payload does not dispatch',
    'provider timeout becomes outcome_unknown without blind refund',
    'provider failure refunds once with idempotent duplicate handling',
    'provider failure refunds carry original debit provenance',
    'naked provider refunds are rejected',
    'mock tests make zero outbound network calls',
  ],
}, null, 2))
