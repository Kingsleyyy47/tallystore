const CENTS = 100n
const SEQUENCE_COUNT = 200
const STEPS_PER_SEQUENCE = 90

class RefundConservationModel {
  constructor() {
    this.wallets = new Map()
    this.orders = new Map()
    this.refundKeys = new Map()
    this.events = []
  }

  balance(walletId) {
    return this.wallets.get(walletId) || 0n
  }

  setBalance(walletId, amount) {
    this.wallets.set(walletId, amount)
  }

  credit(walletId, amount, key) {
    assert(amount > 0n, 'credit amount must be positive')
    this.setBalance(walletId, this.balance(walletId) + amount)
    this.events.push({ type: 'verified_credit', walletId, amount, key })
  }

  captureOrder(walletId, orderId, amount) {
    assert(amount > 0n, 'order amount must be positive')
    assert(!this.orders.has(orderId), 'order already exists')
    const before = this.balance(walletId)
    if (before < amount) return { ok: false, code: 'INSUFFICIENT_FUNDS' }
    this.setBalance(walletId, before - amount)
    this.orders.set(orderId, {
      id: orderId,
      walletId,
      amount,
      refunded: 0n,
      status: 'captured',
    })
    this.events.push({ type: 'captured_debit', walletId, orderId, amount })
    this.assertInvariants()
    return { ok: true, code: 'CAPTURED' }
  }

  refundOrder(walletId, orderId, refundId, amount) {
    assert(amount > 0n, 'refund amount must be positive')
    const fingerprint = `${walletId}:${orderId}:${amount.toString()}`
    const existing = this.refundKeys.get(refundId)
    if (existing) {
      if (existing !== fingerprint) return { ok: false, code: 'REFUND_IDEMPOTENCY_CONFLICT' }
      return { ok: true, code: 'REFUND_IDEMPOTENT_REPLAY' }
    }

    const order = this.orders.get(orderId)
    if (!order) return { ok: false, code: 'ORIGINAL_DEBIT_NOT_FOUND' }
    if (order.walletId !== walletId) return { ok: false, code: 'ORDER_REFUND_OWNER_MISMATCH' }
    if (order.status !== 'captured') return { ok: false, code: 'ORIGINAL_DEBIT_NOT_CAPTURED' }
    if (order.refunded + amount > order.amount) {
      return {
        ok: false,
        code: 'ORDER_REFUND_EXCEEDS_CAPTURED_DEBIT',
        remaining: order.amount - order.refunded,
      }
    }

    const before = this.balance(walletId)
    order.refunded += amount
    this.setBalance(walletId, before + amount)
    this.refundKeys.set(refundId, fingerprint)
    this.events.push({ type: 'partial_refund', walletId, orderId, refundId, amount })
    this.assertInvariants()
    return { ok: true, code: 'PARTIAL_REFUND_POSTED' }
  }

  assertInvariants() {
    for (const order of this.orders.values()) {
      assert(order.refunded <= order.amount, `order ${order.id} refunded more than captured debit`)
      assert(order.amount > 0n, `order ${order.id} has invalid captured debit`)
    }

    for (const [refundId, fingerprint] of this.refundKeys.entries()) {
      assert(typeof refundId === 'string' && refundId.length > 0, 'refund id is missing')
      assert(typeof fingerprint === 'string' && fingerprint.length > 0, 'refund fingerprint is missing')
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function makeRng(seed) {
  let state = BigInt(seed)
  return () => {
    state = (state * 1664525n + 1013904223n) % 4294967296n
    return Number(state) / 4294967296
  }
}

function amount(rng, maxNaira = 25_000) {
  return BigInt(1 + Math.floor(rng() * maxNaira)) * CENTS
}

function pick(rng, items) {
  return items[Math.floor(rng() * items.length)]
}

function specificScenarios() {
  const partial = new RefundConservationModel()
  partial.credit('wallet-a', 10_000n * CENTS, 'credit:a')
  assert(partial.captureOrder('wallet-a', 'order-a', 10_000n * CENTS).ok, 'captured debit failed')
  assert(partial.refundOrder('wallet-a', 'order-a', 'refund-a-1', 3_000n * CENTS).code === 'PARTIAL_REFUND_POSTED', 'first partial refund failed')
  assert(partial.refundOrder('wallet-a', 'order-a', 'refund-a-2', 2_000n * CENTS).code === 'PARTIAL_REFUND_POSTED', 'second partial refund failed')
  assert(partial.orders.get('order-a').refunded === 5_000n * CENTS, 'partial refunds did not accumulate')
  assert(partial.balance('wallet-a') === 5_000n * CENTS, 'partial refunds credited wrong balance')

  const overRefund = partial.refundOrder('wallet-a', 'order-a', 'refund-a-3', 6_000n * CENTS)
  assert(!overRefund.ok && overRefund.code === 'ORDER_REFUND_EXCEEDS_CAPTURED_DEBIT', 'over-refund was not rejected')
  assert(partial.orders.get('order-a').refunded === 5_000n * CENTS, 'rejected over-refund changed order refunded total')

  const replay = partial.refundOrder('wallet-a', 'order-a', 'refund-a-2', 2_000n * CENTS)
  assert(replay.ok && replay.code === 'REFUND_IDEMPOTENT_REPLAY', 'duplicate refund did not replay idempotently')
  assert(partial.balance('wallet-a') === 5_000n * CENTS, 'duplicate refund double-credited wallet')

  const conflict = partial.refundOrder('wallet-a', 'order-a', 'refund-a-2', 1_000n * CENTS)
  assert(!conflict.ok && conflict.code === 'REFUND_IDEMPOTENCY_CONFLICT', 'changed duplicate refund was not rejected')

  const wrongOwner = partial.refundOrder('wallet-b', 'order-a', 'refund-wrong-owner', 100n * CENTS)
  assert(!wrongOwner.ok && wrongOwner.code === 'ORDER_REFUND_OWNER_MISMATCH', 'refund of another wallet debit was not rejected')

  const missingDebit = partial.refundOrder('wallet-a', 'missing-order', 'refund-missing', 100n * CENTS)
  assert(!missingDebit.ok && missingDebit.code === 'ORIGINAL_DEBIT_NOT_FOUND', 'refund without original debit was not rejected')
}

function generatedSequence(seed) {
  const rng = makeRng(seed)
  const model = new RefundConservationModel()
  const wallets = ['wallet-a', 'wallet-b', 'wallet-c']
  const orders = []
  let rejectedRefunds = 0
  let postedRefunds = 0

  for (const walletId of wallets) {
    model.credit(walletId, amount(rng, 80_000), `seed:${seed}:${walletId}`)
  }

  for (let index = 0; index < STEPS_PER_SEQUENCE; index += 1) {
    const action = pick(rng, ['capture', 'partial_refund', 'over_refund', 'wrong_owner_refund', 'duplicate_refund'])
    const walletId = pick(rng, wallets)

    if (action === 'capture' || orders.length === 0) {
      const orderId = `order:${seed}:${index}`
      const result = model.captureOrder(walletId, orderId, amount(rng, 12_000))
      if (result.ok) orders.push(orderId)
      continue
    }

    const orderId = pick(rng, orders)
    const order = model.orders.get(orderId)
    if (!order) continue

    const remaining = order.amount - order.refunded
    const refundId = `refund:${seed}:${index}`
    let result

    if (action === 'wrong_owner_refund') {
      const otherWallet = wallets.find((candidate) => candidate !== order.walletId) || walletId
      result = model.refundOrder(otherWallet, orderId, refundId, CENTS)
    } else if (action === 'over_refund') {
      result = model.refundOrder(order.walletId, orderId, refundId, remaining + CENTS)
    } else if (action === 'duplicate_refund') {
      const amountToRefund = remaining > 0n ? CENTS : order.amount
      const first = model.refundOrder(order.walletId, orderId, refundId, amountToRefund)
      const second = model.refundOrder(order.walletId, orderId, refundId, amountToRefund)
      assert(second.code === (first.ok ? 'REFUND_IDEMPOTENT_REPLAY' : first.code), 'duplicate refund changed outcome unexpectedly')
      result = second
    } else {
      if (remaining <= 0n) {
        result = model.refundOrder(order.walletId, orderId, refundId, CENTS)
      } else {
        const refundAmount = 1n + BigInt(Math.floor(rng() * Number(remaining)))
        result = model.refundOrder(order.walletId, orderId, refundId, refundAmount)
      }
    }

    if (result.ok && result.code === 'PARTIAL_REFUND_POSTED') postedRefunds += 1
    if (!result.ok) rejectedRefunds += 1
    model.assertInvariants()
  }

  return { seed, orders: model.orders.size, postedRefunds, rejectedRefunds }
}

specificScenarios()

const summaries = []
for (let seed = 1; seed <= SEQUENCE_COUNT; seed += 1) {
  summaries.push(generatedSequence(seed))
}

console.log(JSON.stringify({
  ok: true,
  sequences: SEQUENCE_COUNT,
  stepsPerSequence: STEPS_PER_SEQUENCE,
  orders: summaries.reduce((sum, item) => sum + item.orders, 0),
  postedRefunds: summaries.reduce((sum, item) => sum + item.postedRefunds, 0),
  rejectedRefunds: summaries.reduce((sum, item) => sum + item.rejectedRefunds, 0),
  scenarios: [
    'two legitimate partial refunds can restore one captured debit without exceeding it',
    'ORDER_REFUND_EXCEEDS_CAPTURED_DEBIT blocks over-refunds',
    'REFUND_IDEMPOTENT_REPLAY does not double-credit duplicate refunds',
    'REFUND_IDEMPOTENCY_CONFLICT rejects changed duplicate refund payloads',
    'ORDER_REFUND_OWNER_MISMATCH blocks refunding another wallet debit',
    'ORIGINAL_DEBIT_NOT_FOUND blocks refunds without backed original debits',
  ],
}, null, 2))
