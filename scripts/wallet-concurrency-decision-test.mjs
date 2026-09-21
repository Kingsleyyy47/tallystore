const CENTS = 100n

class WalletConcurrencyModel {
  constructor() {
    this.balance = 0n
    this.trustedPrincipal = 0n
    this.trustedConsumedDebit = 0n
    this.frozen = false
    this.postedDebits = 0n
    this.completedRefunds = 0n
    this.linkedEligibleRefunds = 0n
    this.trustedDebits = new Map()
    this.ledger = []
    this.processed = new Map()
    this.tail = Promise.resolve()
  }

  withWalletLock(operation) {
    const run = this.tail.then(operation, operation)
    this.tail = run.catch(() => undefined)
    return run
  }

  async post(event) {
    return this.withWalletLock(async () => {
      const snapshot = this.snapshot()
      try {
        const result = this.applyLocked(event)
        if (event.failAt === 'after_ledger') {
          this.ledger.push({ key: `${event.key}:fault`, type: 'fault_probe', amount: event.amount || 0n })
          throw new Error('FAULT_AFTER_LEDGER')
        }
        if (event.failAt === 'after_balance') {
          if (event.amount) this.balance += event.amount
          throw new Error('FAULT_AFTER_BALANCE')
        }
        this.assertInvariants()
        return result
      } catch (error) {
        this.restore(snapshot)
        return {
          ok: false,
          code: error instanceof Error ? error.message : 'TRANSACTION_FAILED',
        }
      }
    })
  }

  applyLocked(event) {
    validateEvent(event)
    const fingerprint = fingerprintEvent(event)
    const existing = this.processed.get(event.key)
    if (existing) {
      if (existing !== fingerprint) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' }
      return { ok: true, code: 'IDEMPOTENT_REPLAY' }
    }

    if (event.type === 'freeze') {
      this.frozen = true
      this.processed.set(event.key, fingerprint)
      this.ledger.push({ type: 'freeze', key: event.key, balanceAfter: this.balance })
      return { ok: true, code: 'FROZEN' }
    }

    if (this.frozen && ['purchase', 'withdrawal'].includes(event.type)) {
      return { ok: false, code: 'WALLET_FROZEN' }
    }

    if (event.type === 'verified_credit') {
      this.balance += event.amount
      this.trustedPrincipal += event.amount
    } else if (event.type === 'purchase' || event.type === 'withdrawal') {
      if (this.trustedAvailable() < event.amount) {
        if (this.balance > this.trustedBook()) {
          this.frozen = true
          return { ok: false, code: 'WALLET_UNBACKED_FUNDS' }
        }
        return { ok: false, code: 'INSUFFICIENT_FUNDS' }
      }
      if (this.balance < event.amount) return { ok: false, code: 'INSUFFICIENT_FUNDS' }
      this.balance -= event.amount
      this.postedDebits += event.amount
      this.trustedConsumedDebit += event.amount
      this.trustedDebits.set(event.key, {
        amount: event.amount,
        refunded: 0n,
      })
    } else if (event.type === 'refund') {
      if (!event.originalDebitKey) {
        return { ok: false, code: 'REFUND_ORIGINAL_DEBIT_REQUIRED' }
      }
      const originalDebit = this.trustedDebits.get(event.originalDebitKey)
      if (!originalDebit) {
        return { ok: false, code: 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED' }
      }
      if (originalDebit.refunded + event.amount > originalDebit.amount) {
        return { ok: false, code: 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT' }
      }
      this.balance += event.amount
      this.completedRefunds += event.amount
      this.linkedEligibleRefunds += event.amount
      this.trustedConsumedDebit -= event.amount
      originalDebit.refunded += event.amount
    } else if (event.type === 'fake_balance') {
      this.balance += event.amount
    } else {
      throw new Error(`UNHANDLED_EVENT_${event.type}`)
    }

    this.processed.set(event.key, fingerprint)
    this.ledger.push({
      type: event.type,
      key: event.key,
      amount: event.amount,
      balanceAfter: this.balance,
    })
    return { ok: true, code: 'POSTED' }
  }

  snapshot() {
    return {
      balance: this.balance,
      trustedPrincipal: this.trustedPrincipal,
      trustedConsumedDebit: this.trustedConsumedDebit,
      frozen: this.frozen,
      postedDebits: this.postedDebits,
      completedRefunds: this.completedRefunds,
      linkedEligibleRefunds: this.linkedEligibleRefunds,
      trustedDebits: new Map(
        [...this.trustedDebits.entries()].map(([key, debit]) => [key, { ...debit }]),
      ),
      ledger: this.ledger.map((entry) => ({ ...entry })),
      processed: new Map(this.processed),
    }
  }

  restore(snapshot) {
    this.balance = snapshot.balance
    this.trustedPrincipal = snapshot.trustedPrincipal
    this.trustedConsumedDebit = snapshot.trustedConsumedDebit
    this.frozen = snapshot.frozen
    this.postedDebits = snapshot.postedDebits
    this.completedRefunds = snapshot.completedRefunds
    this.linkedEligibleRefunds = snapshot.linkedEligibleRefunds
    this.trustedDebits = snapshot.trustedDebits
    this.ledger = snapshot.ledger
    this.processed = snapshot.processed
  }

  assertInvariants() {
    assert(this.completedRefunds <= this.postedDebits, 'refunds exceed posted debits')
    assert(this.linkedEligibleRefunds === this.completedRefunds, 'accepted refunds must be linked eligible restorations')
    assert(this.trustedPrincipal >= 0n, 'trusted principal went negative')
    assert(this.trustedConsumedDebit >= 0n, 'trusted consumed debit went negative')
    assert(this.trustedConsumedDebit <= this.trustedPrincipal, 'trusted consumed debit exceeded trusted principal')
    assert(this.balance >= -1_000_000_000n * CENTS, 'debt boundary exceeded')
    for (const [key, debit] of this.trustedDebits.entries()) {
      assert(debit.amount > 0n, `non-positive trusted debit for ${key}`)
      assert(debit.refunded >= 0n, `negative refund total for ${key}`)
      assert(debit.refunded <= debit.amount, `refunds exceeded trusted debit for ${key}`)
    }
    for (const entry of this.ledger) {
      if (entry.amount != null) assert(entry.amount >= 0n, `negative ledger amount for ${entry.type}`)
    }
  }

  trustedBook() {
    return this.trustedPrincipal - this.trustedConsumedDebit
  }

  trustedAvailable() {
    return this.trustedBook()
  }
}

function validateEvent(event) {
  assert(event && typeof event === 'object', 'event is required')
  assert(typeof event.key === 'string' && event.key.length > 0, 'event key is required')
  if (event.type === 'freeze') return
  assert(typeof event.amount === 'bigint' && event.amount > 0n, `positive bigint amount required for ${event.type}`)
}

function fingerprintEvent(event) {
  return JSON.stringify({
    type: event.type,
    amount: event.amount == null ? null : event.amount.toString(),
    originalDebitKey: event.originalDebitKey || null,
    source: event.source || null,
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function count(results, code) {
  return results.filter((result) => result.code === code).length
}

async function race(events) {
  return Promise.all(events.map((event) => event.wallet.post(event.payload)))
}

async function simultaneousPurchasesCannotDoubleSpend() {
  const wallet = new WalletConcurrencyModel()
  await wallet.post({ type: 'verified_credit', key: 'seed', amount: 1_000n * CENTS })
  const results = await race([
    { wallet, payload: { type: 'purchase', key: 'purchase-a', amount: 700n * CENTS } },
    { wallet, payload: { type: 'purchase', key: 'purchase-b', amount: 700n * CENTS } },
  ])
  assert(count(results, 'POSTED') === 1, 'exactly one purchase should post')
  assert(count(results, 'INSUFFICIENT_FUNDS') === 1, 'exactly one purchase should fail insufficient funds')
  assert(wallet.balance === 300n * CENTS, 'double-spend race left wrong balance')
  assert(wallet.ledger.filter((entry) => entry.type === 'purchase').length === 1, 'double-spend race posted two purchases')
}

async function depositPurchaseInterleavingIsSerializable() {
  const wallet = new WalletConcurrencyModel()
  await wallet.post({ type: 'verified_credit', key: 'seed', amount: 500n * CENTS })
  const results = await race([
    { wallet, payload: { type: 'verified_credit', key: 'deposit', amount: 300n * CENTS } },
    { wallet, payload: { type: 'purchase', key: 'purchase', amount: 700n * CENTS } },
  ])
  assert(count(results, 'POSTED') === 2, 'deposit plus purchase should both post under one serial order')
  assert(wallet.balance === 100n * CENTS, 'deposit/purchase interleaving left wrong balance')
}

async function freezePurchaseRaceSerializes() {
  const wallet = new WalletConcurrencyModel()
  await wallet.post({ type: 'verified_credit', key: 'seed', amount: 1_000n * CENTS })
  const results = await race([
    { wallet, payload: { type: 'freeze', key: 'freeze' } },
    { wallet, payload: { type: 'purchase', key: 'purchase', amount: 100n * CENTS } },
  ])
  assert(count(results, 'FROZEN') === 1, 'freeze did not post')
  assert(wallet.frozen, 'wallet is not frozen after race')
  if (count(results, 'POSTED') === 1) {
    assert(wallet.balance === 900n * CENTS, 'purchase-before-freeze serial order left wrong balance')
  } else {
    assert(count(results, 'WALLET_FROZEN') === 1, 'purchase-after-freeze was not blocked')
    assert(wallet.balance === 1_000n * CENTS, 'freeze-before-purchase serial order changed balance')
  }
  const later = await wallet.post({ type: 'purchase', key: 'purchase-later', amount: 100n * CENTS })
  assert(!later.ok && later.code === 'WALLET_FROZEN', 'frozen wallet allowed later purchase')
}

async function duplicateRefundRaceDoesNotDoubleCredit() {
  const wallet = new WalletConcurrencyModel()
  await wallet.post({ type: 'verified_credit', key: 'seed', amount: 1_000n * CENTS })
  await wallet.post({ type: 'purchase', key: 'purchase', amount: 800n * CENTS })
  const results = await race([
    { wallet, payload: { type: 'refund', key: 'refund', amount: 300n * CENTS, originalDebitKey: 'purchase' } },
    { wallet, payload: { type: 'refund', key: 'refund', amount: 300n * CENTS, originalDebitKey: 'purchase' } },
  ])
  assert(count(results, 'POSTED') === 1, 'one refund should post')
  assert(count(results, 'IDEMPOTENT_REPLAY') === 1, 'duplicate refund should replay')
  assert(wallet.balance === 500n * CENTS, 'duplicate refund race double-credited wallet')
  assert(wallet.completedRefunds === 300n * CENTS, 'duplicate refund race changed refund total twice')
  assert(wallet.linkedEligibleRefunds === 300n * CENTS, 'duplicate refund race changed linked eligible refund total twice')
}

async function looseRefundCannotCreateSpendableValue() {
  const wallet = new WalletConcurrencyModel()
  await wallet.post({ type: 'fake_balance', key: 'fake-balance', amount: 500_000n * CENTS })
  const looseRefund = await wallet.post({ type: 'refund', key: 'loose-refund', amount: 20_000n * CENTS })
  assert(!looseRefund.ok && looseRefund.code === 'REFUND_ORIGINAL_DEBIT_REQUIRED', 'loose refund was accepted as trusted value')
  const untrustedLinkedRefund = await wallet.post({
    type: 'refund',
    key: 'untrusted-linked-refund',
    amount: 20_000n * CENTS,
    originalDebitKey: 'missing-or-untrusted-debit',
  })
  assert(!untrustedLinkedRefund.ok && untrustedLinkedRefund.code === 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED', 'refund linked to untrusted debit was accepted')
  const blockedPurchase = await wallet.post({ type: 'purchase', key: 'purchase-after-fake', amount: 1n * CENTS })
  assert(!blockedPurchase.ok && blockedPurchase.code === 'WALLET_UNBACKED_FUNDS', 'fake balance plus rejected refunds authorized spend')
  assert(wallet.trustedPrincipal === 0n, 'loose refund changed trusted principal')
  assert(wallet.trustedAvailable() === 0n, 'loose refund created trusted availability')
}

async function transactionFaultsRollBackPartialWork() {
  const wallet = new WalletConcurrencyModel()
  await wallet.post({ type: 'verified_credit', key: 'seed', amount: 1_000n * CENTS })
  const afterLedger = await wallet.post({
    type: 'purchase',
    key: 'fault-ledger',
    amount: 200n * CENTS,
    failAt: 'after_ledger',
  })
  assert(!afterLedger.ok && afterLedger.code === 'FAULT_AFTER_LEDGER', 'after-ledger fault did not fail')
  assert(wallet.balance === 1_000n * CENTS, 'after-ledger fault changed balance')
  assert(!wallet.processed.has('fault-ledger'), 'after-ledger fault kept idempotency marker')
  assert(!wallet.ledger.some((entry) => entry.key === 'fault-ledger'), 'after-ledger fault kept purchase ledger')

  const afterBalance = await wallet.post({
    type: 'purchase',
    key: 'fault-balance',
    amount: 200n * CENTS,
    failAt: 'after_balance',
  })
  assert(!afterBalance.ok && afterBalance.code === 'FAULT_AFTER_BALANCE', 'after-balance fault did not fail')
  assert(wallet.balance === 1_000n * CENTS, 'after-balance fault changed balance')
  assert(!wallet.processed.has('fault-balance'), 'after-balance fault kept idempotency marker')
}

await simultaneousPurchasesCannotDoubleSpend()
await depositPurchaseInterleavingIsSerializable()
await freezePurchaseRaceSerializes()
await duplicateRefundRaceDoesNotDoubleCredit()
await looseRefundCannotCreateSpendableValue()
await transactionFaultsRollBackPartialWork()

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'simultaneous purchases exceeding funds serialize to one posted debit and one insufficient-funds decline',
    'concurrent deposit and purchase produce a serializable backed balance',
    'concurrent freeze and purchase have a defined serialization and freeze blocks later purchases',
    'duplicate linked refund race posts once and replays once without double-crediting',
    'loose or untrusted-linked refunds cannot create spendable trusted value',
    'faults after ledger-like or balance-like work roll back partial mutation and idempotency state',
  ],
}, null, 2))
