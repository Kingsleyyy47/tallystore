class OutboxModel {
  constructor() {
    this.orders = new Map()
    this.outbox = new Map()
    this.dispatchKeys = new Map()
    this.supplierCalls = []
    this.walletState = 'active'
    this.financialSecurityVersion = 1
    this.nextOutboxId = 1
  }

  authorizeOrder({
    orderId,
    amount,
    availableFunds,
    crashAt = null,
    dispatchKey = null,
    payload = {},
    reservationCommitted = true,
  }) {
    if (this.walletState !== 'active') return { ok: false, code: 'WALLET_NOT_ACTIVE' }
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, code: 'INVALID_AMOUNT' }
    if (!Number.isFinite(availableFunds)) return { ok: false, code: 'FINANCIAL_STATE_UNAVAILABLE' }
    if (availableFunds < amount) return { ok: false, code: 'INSUFFICIENT_FUNDS' }
    if (!reservationCommitted) return { ok: false, code: 'FULFILLMENT_RESERVATION_REQUIRED' }

    const idempotencyKey = dispatchKey || `dispatch:${orderId}`
    const existingMessageId = this.dispatchKeys.get(idempotencyKey)
    if (existingMessageId) {
      const existingMessage = this.outbox.get(existingMessageId)
      if (
        existingMessage.orderId !== orderId ||
        existingMessage.amount !== amount ||
        existingMessage.financialSecurityVersion !== this.financialSecurityVersion ||
        JSON.stringify(existingMessage.payload) !== JSON.stringify(payload)
      ) {
        return { ok: false, code: 'FULFILLMENT_DISPATCH_IDEMPOTENCY_CONFLICT', message: existingMessage }
      }

      return { ok: true, code: 'IDEMPOTENT_REPLAY', message: existingMessage }
    }

    const order = {
      id: orderId,
      amount,
      status: 'funds_held',
      authorization: {
        amount,
        consumed: false,
        financialSecurityVersion: this.financialSecurityVersion,
      },
    }
    const message = {
      id: `outbox-${this.nextOutboxId}`,
      orderId,
      amount,
      status: 'pending',
      attempts: 0,
      claimedBy: null,
      idempotencyKey,
      payload,
      financialSecurityVersion: this.financialSecurityVersion,
    }

    if (crashAt === 'before_commit') return { ok: false, code: 'TRANSACTION_ROLLED_BACK' }

    this.orders.set(orderId, order)
    this.outbox.set(message.id, message)
    this.dispatchKeys.set(idempotencyKey, message.id)
    this.nextOutboxId += 1

    if (crashAt === 'after_commit') return { ok: true, code: 'COMMITTED_APP_CRASHED_AFTER_COMMIT', order, message }

    return { ok: true, code: 'COMMITTED', order, message }
  }

  freezeWallet() {
    this.walletState = 'frozen'
    this.financialSecurityVersion += 1
  }

  claimNext(workerId) {
    const message = [...this.outbox.values()].find((item) => item.status === 'pending')
    if (!message) return { ok: false, code: 'NO_PENDING_MESSAGES' }
    message.status = 'claimed'
    message.claimedBy = workerId
    message.attempts += 1
    return { ok: true, code: 'CLAIMED', message }
  }

  dispatchClaim(workerId, messageId) {
    const message = this.outbox.get(messageId)
    if (!message || message.claimedBy !== workerId || message.status !== 'claimed') {
      return { sendSupplier: false, code: 'OUTBOX_CLAIM_INVALID' }
    }
    const order = this.orders.get(message.orderId)
    if (!order) return this.markBlocked(message, 'ORDER_NOT_FOUND')
    if (this.walletState !== 'active') return this.markBlocked(message, 'WALLET_NOT_ACTIVE')
    if (message.financialSecurityVersion !== this.financialSecurityVersion) {
      return this.markBlocked(message, 'ORDER_AUTHORIZATION_STALE')
    }
    if (!order.authorization || order.authorization.consumed) {
      return this.markBlocked(message, 'ORDER_AUTHORIZATION_INVALID')
    }
    if (order.authorization.financialSecurityVersion !== this.financialSecurityVersion) {
      return this.markBlocked(message, 'ORDER_AUTHORIZATION_STALE')
    }
    if (order.authorization.amount !== order.amount) {
      return this.markBlocked(message, 'ORDER_AUTHORIZATION_AMOUNT_MISMATCH')
    }
    if (order.status !== 'funds_held') {
      return this.markBlocked(message, 'ORDER_STATE_NOT_DISPATCHABLE')
    }

    order.status = 'dispatch_claimed'
    order.authorization.consumed = true
    message.status = 'sent'
    this.supplierCalls.push({ orderId: order.id, amount: order.amount, workerId })
    return { sendSupplier: true, code: 'SUPPLIER_DISPATCHED' }
  }

  finishClaim(workerId, messageId, status) {
    const message = this.outbox.get(messageId)
    if (!message || message.claimedBy !== workerId || message.status !== 'claimed') {
      return { ok: false, code: 'OUTBOX_CLAIM_INVALID' }
    }
    if (!['sent', 'blocked', 'failed', 'canceled'].includes(status)) {
      return { ok: false, code: 'FULFILLMENT_DISPATCH_FINISH_STATUS_INVALID' }
    }

    message.status = status
    return { ok: true, code: 'FULFILLMENT_DISPATCH_FINISHED', status }
  }

  markBlocked(message, code) {
    message.status = 'blocked'
    message.blockedReason = code
    return { sendSupplier: false, code }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function committedOutboxSurvivesCrash() {
  const model = new OutboxModel()
  const committed = model.authorizeOrder({
    orderId: 'order-after-commit-crash',
    amount: 5000,
    availableFunds: 10_000,
    crashAt: 'after_commit',
  })
  assert(committed.ok && committed.code === 'COMMITTED_APP_CRASHED_AFTER_COMMIT', 'post-commit crash did not leave durable order/outbox state')
  const claim = model.claimNext('worker-a')
  assert(claim.ok && claim.message.orderId === 'order-after-commit-crash', 'worker could not recover committed outbox message')
  const dispatch = model.dispatchClaim('worker-a', claim.message.id)
  assert(dispatch.sendSupplier && dispatch.code === 'SUPPLIER_DISPATCHED', 'recovered committed outbox did not dispatch once')
  assert(model.supplierCalls.length === 1, 'committed crash recovery dispatched more than once')
}

function rolledBackOutboxDoesNotDispatch() {
  const model = new OutboxModel()
  const rolledBack = model.authorizeOrder({
    orderId: 'order-before-commit-crash',
    amount: 5000,
    availableFunds: 10_000,
    crashAt: 'before_commit',
  })
  assert(!rolledBack.ok && rolledBack.code === 'TRANSACTION_ROLLED_BACK', 'pre-commit crash was not rolled back')
  assert(model.claimNext('worker-a').code === 'NO_PENDING_MESSAGES', 'rolled-back authorization left an outbox message')
  assert(model.supplierCalls.length === 0, 'rolled-back authorization dispatched supplier')
}

function oldQueueMessageCannotDispatchAfterFreeze() {
  const model = new OutboxModel()
  const committed = model.authorizeOrder({ orderId: 'order-freeze-race', amount: 5000, availableFunds: 10_000 })
  assert(committed.ok, 'setup authorization failed')
  model.freezeWallet()
  const claim = model.claimNext('worker-a')
  assert(claim.ok, 'worker could not claim stale message')
  const dispatch = model.dispatchClaim('worker-a', claim.message.id)
  assert(!dispatch.sendSupplier && dispatch.code === 'WALLET_NOT_ACTIVE', 'old queue message dispatched after freeze')
  assert(model.supplierCalls.length === 0, 'frozen stale message called supplier')
}

function twoWorkersCannotDispatchSameMessage() {
  const model = new OutboxModel()
  const committed = model.authorizeOrder({ orderId: 'order-double-worker', amount: 5000, availableFunds: 10_000 })
  assert(committed.ok, 'setup authorization failed')
  const firstClaim = model.claimNext('worker-a')
  const secondClaim = model.claimNext('worker-b')
  assert(firstClaim.ok, 'first worker did not claim message')
  assert(!secondClaim.ok && secondClaim.code === 'NO_PENDING_MESSAGES', 'second worker claimed the same pending message')
  const firstDispatch = model.dispatchClaim('worker-a', firstClaim.message.id)
  const secondDispatch = model.dispatchClaim('worker-b', firstClaim.message.id)
  assert(firstDispatch.sendSupplier, 'first worker did not dispatch claimed message')
  assert(!secondDispatch.sendSupplier && secondDispatch.code === 'OUTBOX_CLAIM_INVALID', 'second worker dispatched without a valid claim')
  assert(model.supplierCalls.length === 1, 'two workers dispatched the same logical order')
}

function staleVersionBlocksEvenIfWalletReopens() {
  const model = new OutboxModel()
  const committed = model.authorizeOrder({ orderId: 'order-stale-version', amount: 5000, availableFunds: 10_000 })
  assert(committed.ok, 'setup authorization failed')
  model.freezeWallet()
  model.walletState = 'active'
  const claim = model.claimNext('worker-a')
  assert(claim.ok, 'worker could not claim stale-version message')
  const dispatch = model.dispatchClaim('worker-a', claim.message.id)
  assert(!dispatch.sendSupplier && dispatch.code === 'ORDER_AUTHORIZATION_STALE', 'stale authorization dispatched after security-version change')
  assert(model.supplierCalls.length === 0, 'stale authorization called supplier')
}

function enqueueRequiresCommittedReservation() {
  const model = new OutboxModel()
  const denied = model.authorizeOrder({
    orderId: 'order-without-reservation',
    amount: 5000,
    availableFunds: 10_000,
    reservationCommitted: false,
  })
  assert(!denied.ok && denied.code === 'FULFILLMENT_RESERVATION_REQUIRED', 'dispatch was authorized without a committed reservation')
  assert(model.orders.size === 0 && model.outbox.size === 0, 'missing-reservation dispatch created durable order or outbox state')
  assert(model.supplierCalls.length === 0, 'missing-reservation dispatch called supplier')
}

function enqueueIdempotencyBlocksChangedDispatch() {
  const model = new OutboxModel()
  const first = model.authorizeOrder({
    orderId: 'order-idempotent',
    amount: 5000,
    availableFunds: 10_000,
    dispatchKey: 'dispatch:same-key',
    payload: { route: 'product' },
  })
  const replay = model.authorizeOrder({
    orderId: 'order-idempotent',
    amount: 5000,
    availableFunds: 10_000,
    dispatchKey: 'dispatch:same-key',
    payload: { route: 'product' },
  })
  const conflict = model.authorizeOrder({
    orderId: 'order-idempotent',
    amount: 5000,
    availableFunds: 10_000,
    dispatchKey: 'dispatch:same-key',
    payload: { route: 'changed' },
  })
  assert(first.ok && first.code === 'COMMITTED', 'first idempotent dispatch was not committed')
  assert(replay.ok && replay.code === 'IDEMPOTENT_REPLAY', 'exact idempotent replay did not return existing dispatch')
  assert(!conflict.ok && conflict.code === 'FULFILLMENT_DISPATCH_IDEMPOTENCY_CONFLICT', 'changed dispatch reused an idempotency key')
  assert(model.outbox.size === 1, 'changed idempotency conflict created a second outbox message')
}

function finishRequiresClaimingWorker() {
  const model = new OutboxModel()
  const committed = model.authorizeOrder({ orderId: 'order-finish-owner', amount: 5000, availableFunds: 10_000 })
  assert(committed.ok, 'setup authorization failed')
  const claim = model.claimNext('worker-a')
  assert(claim.ok, 'worker could not claim message')
  const wrongWorker = model.finishClaim('worker-b', claim.message.id, 'sent')
  assert(!wrongWorker.ok && wrongWorker.code === 'OUTBOX_CLAIM_INVALID', 'non-claiming worker finished a dispatch')
  const rightWorker = model.finishClaim('worker-a', claim.message.id, 'sent')
  assert(rightWorker.ok && rightWorker.code === 'FULFILLMENT_DISPATCH_FINISHED', 'claiming worker could not finish dispatch')
}

committedOutboxSurvivesCrash()
rolledBackOutboxDoesNotDispatch()
oldQueueMessageCannotDispatchAfterFreeze()
twoWorkersCannotDispatchSameMessage()
staleVersionBlocksEvenIfWalletReopens()
enqueueRequiresCommittedReservation()
enqueueIdempotencyBlocksChangedDispatch()
finishRequiresClaimingWorker()

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'post-commit crash leaves a recoverable outbox message',
    'pre-commit crash leaves no order, no outbox message, and no supplier call',
    'old queue message after wallet freeze cannot dispatch',
    'two workers cannot dispatch the same claimed message',
    'financial-security version changes invalidate stale queued authorizations even if wallet reopens',
    'dispatch requires a committed wallet reservation before enqueue',
    'changed dispatch payload cannot reuse an outbox idempotency key',
    'only the claiming worker can finish a dispatch message',
  ],
}, null, 2))
