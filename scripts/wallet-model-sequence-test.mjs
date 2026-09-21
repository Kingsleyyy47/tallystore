const CENTS = 100n
const MAX_AMOUNT = 1_000_000_000n * CENTS
const SEQUENCE_COUNT = 400
const STEPS_PER_SEQUENCE = 160

class WalletModel {
  constructor() {
    this.book = 0n
    this.trustedPrincipal = 0n
    this.trustedConsumedDebit = 0n
    this.reserved = 0n
    this.frozen = false
    this.postedDebits = 0n
    this.completedRefunds = 0n
    this.processed = new Map()
    this.events = []
  }

  apply(event) {
    validateEvent(event)
    const existing = this.processed.get(event.key)
    const fingerprint = fingerprintEvent(event)
    if (existing) {
      if (existing !== fingerprint) {
        return { ok: false, code: 'IDEMPOTENCY_CONFLICT' }
      }
      return { ok: true, code: 'IDEMPOTENT_REPLAY' }
    }

    if (event.type === 'freeze') {
      this.frozen = true
      this.processed.set(event.key, fingerprint)
      this.events.push({ ...event, balanceAfter: this.book })
      return { ok: true, code: 'FROZEN' }
    }

    if (this.frozen && ['purchase', 'withdrawal', 'reserve', 'capture_reservation'].includes(event.type)) {
      return { ok: false, code: 'WALLET_FROZEN' }
    }

    const before = this.book
    let after = before

    if (event.type === 'verified_credit' || event.type === 'approved_adjustment') {
      after += event.amount
      this.trustedPrincipal += event.amount
    } else if (event.type === 'fake_balance' || event.type === 'internal_movement') {
      after += event.amount
    } else if (event.type === 'legacy_unbacked_debit') {
      after -= event.amount
      this.postedDebits += event.amount
    } else if (event.type === 'purchase' || event.type === 'withdrawal') {
      after -= event.amount
      if (after < 0n) return { ok: false, code: 'INSUFFICIENT_FUNDS' }
      if (this.trustedAvailable() < event.amount) {
        if (this.book <= this.trustedBook()) return { ok: false, code: 'INSUFFICIENT_FUNDS' }
        this.frozen = true
        return { ok: false, code: 'WALLET_UNBACKED_FUNDS' }
      }
      this.postedDebits += event.amount
      this.trustedConsumedDebit += event.amount
    } else if (event.type === 'reserve') {
      if (this.trustedAvailable() < event.amount) return { ok: false, code: 'INSUFFICIENT_FUNDS' }
      this.reserved += event.amount
    } else if (event.type === 'release_reservation') {
      if (this.reserved < event.amount) return { ok: false, code: 'RESERVATION_NOT_FOUND' }
      this.reserved -= event.amount
    } else if (event.type === 'capture_reservation') {
      if (this.reserved < event.amount) return { ok: false, code: 'RESERVATION_NOT_FOUND' }
      after -= event.amount
      if (after < 0n) return { ok: false, code: 'INSUFFICIENT_FUNDS' }
      this.reserved -= event.amount
      this.postedDebits += event.amount
      this.trustedConsumedDebit += event.amount
    } else if (event.type === 'refund') {
      if (this.completedRefunds + event.amount > this.trustedConsumedDebit) {
        return { ok: false, code: 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT' }
      }
      after += event.amount
      this.completedRefunds += event.amount
      this.trustedConsumedDebit -= event.amount
    } else if (event.type === 'chargeback') {
      after -= event.amount
      this.frozen = true
    } else {
      throw new Error(`Unhandled event type ${event.type}`)
    }

    this.book = after
    this.processed.set(event.key, fingerprint)
    this.events.push({ ...event, balanceBefore: before, balanceAfter: after })
    this.assertInvariants()
    return { ok: true, code: 'POSTED' }
  }

  assertInvariants() {
    assert(this.trustedPrincipal >= 0n, 'trusted principal went negative')
    assert(this.trustedConsumedDebit >= 0n, 'trusted consumed debit went negative')
    assert(this.trustedConsumedDebit <= this.trustedPrincipal, 'trusted consumed debit exceeded trusted principal')
    assert(this.reserved >= 0n, 'reserved amount went negative')
    assert(this.reserved <= this.trustedPrincipal - this.trustedConsumedDebit, 'reserved amount exceeded trusted available principal')
    assert(this.completedRefunds <= this.postedDebits, 'refunds exceeded completed debits')
    assert(this.book >= -MAX_AMOUNT, 'chargeback/debt boundary exceeded')
    for (const event of this.events) {
      if (event.amount != null) {
        assert(event.amount > 0n, `non-positive posted amount for ${event.type}`)
        assert(event.amount <= MAX_AMOUNT, `oversized posted amount for ${event.type}`)
      }
    }
  }

  trustedAvailable() {
    return this.trustedBook() - this.reserved
  }

  trustedBook() {
    return this.trustedPrincipal - this.trustedConsumedDebit
  }
}

function validateEvent(event) {
  assert(event && typeof event === 'object', 'event must be an object')
  assert(typeof event.key === 'string' && event.key.length > 0, 'event key is required')
  if (event.type === 'freeze') return
  assert(typeof event.amount === 'bigint', `amount must be bigint for ${event.type}`)
  assert(event.amount > 0n, `amount must be positive for ${event.type}`)
  assert(event.amount <= MAX_AMOUNT, `amount exceeds max for ${event.type}`)
}

function fingerprintEvent(event) {
  return JSON.stringify({
    type: event.type,
    amount: event.amount == null ? null : event.amount.toString(),
    source: event.source || null,
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function makeRng(seed) {
  let state = BigInt(seed)
  return () => {
    state = (state * 1103515245n + 12345n) % 2147483648n
    return Number(state) / 2147483648
  }
}

function pick(rng, items) {
  return items[Math.floor(rng() * items.length)]
}

function amount(rng, maxNaira = 80_000) {
  const naira = 1 + Math.floor(rng() * maxNaira)
  return BigInt(naira) * CENTS
}

function generatedSequence(seed) {
  const rng = makeRng(seed)
  const wallet = new WalletModel()
  const acceptedKeys = []

  for (let index = 0; index < STEPS_PER_SEQUENCE; index += 1) {
    const type = pick(rng, [
      'verified_credit',
      'purchase',
      'refund',
      'approved_adjustment',
      'fake_balance',
      'internal_movement',
      'reserve',
      'release_reservation',
      'capture_reservation',
      'chargeback',
      'withdrawal',
      'freeze',
      'idempotent_replay',
      'idempotency_conflict',
    ])

    let event
    if (type === 'idempotent_replay' && acceptedKeys.length > 0) {
      event = acceptedKeys[Math.floor(rng() * acceptedKeys.length)]
      const result = wallet.apply(event)
      assert(result.ok && result.code === 'IDEMPOTENT_REPLAY', 'idempotent replay changed state or failed')
      continue
    }

    if (type === 'idempotency_conflict' && acceptedKeys.length > 0) {
      const original = acceptedKeys[Math.floor(rng() * acceptedKeys.length)]
      event = { ...original, amount: (original.amount || CENTS) + CENTS }
      const before = wallet.book
      const result = wallet.apply(event)
      assert(!result.ok && result.code === 'IDEMPOTENCY_CONFLICT', 'idempotency conflict was not rejected')
      assert(wallet.book === before, 'idempotency conflict changed the wallet')
      continue
    }

    const postingType = ['idempotent_replay', 'idempotency_conflict'].includes(type)
      ? 'verified_credit'
      : type
    event = {
      type: postingType,
      key: `${seed}:${index}:${postingType}`,
      amount: postingType === 'freeze' ? undefined : amount(rng),
      source: ['verified_credit', 'approved_adjustment'].includes(postingType)
        ? 'verified-provider-or-approval'
        : postingType === 'fake_balance'
          ? 'hostile-untrusted-balance'
          : postingType === 'internal_movement'
            ? 'internal-non-principal-balance'
            : 'generated-sequence',
    }

    const before = wallet.book
    const result = wallet.apply(event)
    if (result.ok && result.code !== 'IDEMPOTENT_REPLAY') acceptedKeys.push(event)
    if (!result.ok) {
      assert(wallet.book === before, `${result.code} changed wallet balance`)
    }
  }

  wallet.assertInvariants()
  return {
    seed,
    finalBalance: wallet.book,
    postedEvents: wallet.events.length,
    postedDebits: wallet.postedDebits,
    completedRefunds: wallet.completedRefunds,
    frozen: wallet.frozen,
  }
}

function specificScenarios() {
  const overspend = new WalletModel()
  assert(overspend.apply({ type: 'verified_credit', key: 'credit:1', amount: 2_000n * CENTS }).ok, 'seed credit failed')
  const denied = overspend.apply({ type: 'purchase', key: 'purchase:1', amount: 5_000n * CENTS })
  assert(!denied.ok && denied.code === 'INSUFFICIENT_FUNDS', 'overspend was not an ordinary insufficient-funds decline')
  assert(overspend.book === 2_000n * CENTS, 'overspend changed balance')

  const refundCap = new WalletModel()
  refundCap.apply({ type: 'verified_credit', key: 'credit:2', amount: 10_000n * CENTS })
  refundCap.apply({ type: 'purchase', key: 'purchase:2', amount: 4_000n * CENTS })
  const overRefund = refundCap.apply({ type: 'refund', key: 'refund:2', amount: 5_000n * CENTS })
  assert(!overRefund.ok && overRefund.code === 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT', 'over-refund was not rejected')

  const fakeBalance = new WalletModel()
  assert(fakeBalance.apply({ type: 'fake_balance', key: 'fake:1', amount: 500_000n * CENTS }).ok, 'fake balance setup failed')
  const fakeBalancePurchase = fakeBalance.apply({ type: 'purchase', key: 'purchase:fake', amount: 1n * CENTS })
  assert(!fakeBalancePurchase.ok && fakeBalancePurchase.code === 'WALLET_UNBACKED_FUNDS', 'fake displayed balance authorized product spend')

  const internalMovement = new WalletModel()
  assert(internalMovement.apply({ type: 'internal_movement', key: 'internal:1', amount: 50_000n * CENTS }).ok, 'internal movement setup failed')
  const internalPurchase = internalMovement.apply({ type: 'purchase', key: 'purchase:internal', amount: 1n * CENTS })
  assert(!internalPurchase.ok && internalPurchase.code === 'WALLET_UNBACKED_FUNDS', 'internal movement authorized product spend as trusted principal')

  const legacyUnbacked = new WalletModel()
  legacyUnbacked.apply({ type: 'fake_balance', key: 'fake:legacy', amount: 100_000n * CENTS })
  legacyUnbacked.apply({ type: 'legacy_unbacked_debit', key: 'legacy:debit', amount: 10_000n * CENTS })
  const unbackedRefund = legacyUnbacked.apply({ type: 'refund', key: 'refund:legacy', amount: 10_000n * CENTS })
  assert(!unbackedRefund.ok && unbackedRefund.code === 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT', 'refund of unbacked legacy debit became trusted spendable value')

  const freeze = new WalletModel()
  freeze.apply({ type: 'verified_credit', key: 'credit:3', amount: 10_000n * CENTS })
  freeze.apply({ type: 'freeze', key: 'freeze:3' })
  const frozenPurchase = freeze.apply({ type: 'purchase', key: 'purchase:3', amount: 1_000n * CENTS })
  assert(!frozenPurchase.ok && frozenPurchase.code === 'WALLET_FROZEN', 'frozen wallet allowed purchase')
  assert(freeze.apply({ type: 'verified_credit', key: 'credit:4', amount: 1_000n * CENTS }).ok, 'frozen wallet blocked incoming verified credit')

  const replay = new WalletModel()
  const event = { type: 'verified_credit', key: 'same-payment', amount: 7_000n * CENTS }
  assert(replay.apply(event).ok, 'first payment failed')
  assert(replay.apply(event).code === 'IDEMPOTENT_REPLAY', 'duplicate payment did not replay idempotently')
  assert(replay.book === 7_000n * CENTS, 'duplicate payment double credited')

  const reservation = new WalletModel()
  reservation.apply({ type: 'verified_credit', key: 'credit:reserve', amount: 100_000n * CENTS })
  assert(reservation.apply({ type: 'reserve', key: 'reserve:1', amount: 30_000n * CENTS }).ok, 'valid reservation was rejected')
  assert(reservation.book === 100_000n * CENTS, 'reservation changed book balance')
  assert(reservation.trustedAvailable() === 70_000n * CENTS, 'reservation did not reduce available balance')
  assert(reservation.apply({ type: 'purchase', key: 'purchase:reserved-too-much', amount: 80_000n * CENTS }).code === 'INSUFFICIENT_FUNDS', 'new purchase ignored active reservation')
  assert(reservation.apply({ type: 'capture_reservation', key: 'capture:1', amount: 30_000n * CENTS }).ok, 'reservation capture failed')
  assert(reservation.book === 70_000n * CENTS, 'reservation capture did not debit book balance')
  assert(reservation.reserved === 0n, 'reservation capture did not consume hold')
}

specificScenarios()

const summaries = []
for (let seed = 1; seed <= SEQUENCE_COUNT; seed += 1) {
  summaries.push(generatedSequence(seed))
}

const totalEvents = summaries.reduce((sum, item) => sum + item.postedEvents, 0)
console.log(JSON.stringify({
  ok: true,
  sequences: SEQUENCE_COUNT,
  stepsPerSequence: STEPS_PER_SEQUENCE,
  postedEvents: totalEvents,
  scenarios: [
    'ordinary insufficient funds leaves wallet unchanged',
    'refunds cannot exceed trusted original debits',
    'fake or internal wallet balance cannot authorize product spend',
    'valid reservations reduce trusted available without creating fake-balance fraud',
    'frozen wallets block outgoing purchases but accept incoming verified credits',
    'idempotent replays do not double-credit',
    'changed idempotency payloads are rejected without mutation',
  ],
}, null, 2))
