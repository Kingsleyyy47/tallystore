class ReservationModel {
  constructor() {
    this.trustedPrincipal = 0
    this.trustedConsumedSpend = 0
    this.reservations = new Map()
    this.reservationKeys = new Map()
    this.transactions = []
    this.now = new Date('2026-09-19T00:00:00.000Z')
    this.nextReservationId = 1
  }

  get trustedAvailable() {
    return Math.max(this.trustedPrincipal - this.trustedConsumedSpend - this.activeHoldTotal(), 0)
  }

  activeHoldTotal() {
    return [...this.reservations.values()]
      .filter((reservation) => reservation.status === 'active' && reservation.expiresAt > this.now)
      .reduce((sum, reservation) => sum + reservation.amount, 0)
  }

  postVerifiedPayment(amount) {
    this.trustedPrincipal += amount
    this.transactions.push({ type: 'deposit', amount, trustedPrincipal: true })
  }

  postApprovedAdminCredit(amount) {
    this.trustedPrincipal += amount
    this.transactions.push({ type: 'admin_credit', amount, trustedPrincipal: true })
  }

  postRefund(amount) {
    const refundable = Math.min(amount, this.trustedConsumedSpend)
    this.trustedConsumedSpend -= refundable
    this.transactions.push({ type: 'refund', amount: refundable, trustedPrincipal: false })
    return { ok: refundable === amount, restored: refundable }
  }

  createReservation({ walletId, orderId, amount, idempotencyKey, payload = {}, ttlSeconds = 900 }) {
    if (!walletId || !orderId || !idempotencyKey) return { ok: false, code: 'WALLET_RESERVATION_INPUT_INVALID' }
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, code: 'WALLET_RESERVATION_AMOUNT_INVALID' }

    const existingId = this.reservationKeys.get(idempotencyKey)
    if (existingId) {
      const existing = this.reservations.get(existingId)
      if (
        existing.walletId !== walletId ||
        existing.orderId !== orderId ||
        existing.amount !== amount ||
        JSON.stringify(existing.payload) !== JSON.stringify(payload)
      ) {
        return { ok: false, code: 'WALLET_RESERVATION_IDEMPOTENCY_CONFLICT', reservation: existing }
      }

      return { ok: true, code: 'WALLET_RESERVATION_IDEMPOTENT_REPLAY', reservation: existing }
    }

    if (amount > this.trustedAvailable) {
      return { ok: false, code: 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS' }
    }

    const id = `reservation-${this.nextReservationId}`
    const reservation = {
      id,
      walletId,
      orderId,
      amount,
      idempotencyKey,
      payload,
      status: 'active',
      expiresAt: new Date(this.now.getTime() + ttlSeconds * 1000),
    }
    this.nextReservationId += 1
    this.reservations.set(id, reservation)
    this.reservationKeys.set(idempotencyKey, id)

    return { ok: true, code: 'WALLET_RESERVATION_CREATED', reservation }
  }

  captureReservation({ reservationId, idempotencyKey }) {
    const reservation = this.reservations.get(reservationId)
    if (!reservation) return { ok: false, code: 'WALLET_RESERVATION_NOT_FOUND' }
    if (reservation.status === 'captured') return { ok: true, code: 'WALLET_RESERVATION_CAPTURE_REPLAY', reservation }
    if (reservation.status === 'released') return { ok: false, code: 'WALLET_RESERVATION_ALREADY_RELEASED' }
    if (reservation.expiresAt <= this.now) return { ok: false, code: 'WALLET_RESERVATION_EXPIRED' }
    if (!idempotencyKey) return { ok: false, code: 'WALLET_RESERVATION_CAPTURE_KEY_REQUIRED' }

    reservation.status = 'captured'
    reservation.captureIdempotencyKey = idempotencyKey
    this.trustedConsumedSpend += reservation.amount
    this.transactions.push({
      type: 'purchase',
      amount: -reservation.amount,
      trustedPrincipal: false,
      reservationId,
      idempotencyKey,
    })

    return { ok: true, code: 'WALLET_RESERVATION_CAPTURED', reservation }
  }

  releaseReservation({ reservationId }) {
    const reservation = this.reservations.get(reservationId)
    if (!reservation) return { ok: false, code: 'WALLET_RESERVATION_NOT_FOUND' }
    if (reservation.status === 'released') return { ok: true, code: 'WALLET_RESERVATION_RELEASE_REPLAY', reservation }
    if (reservation.status === 'captured') return { ok: false, code: 'WALLET_RESERVATION_ALREADY_CAPTURED' }

    reservation.status = 'released'
    reservation.releasedAt = new Date(this.now)
    return { ok: true, code: 'WALLET_RESERVATION_RELEASED', reservation }
  }

  advance(seconds) {
    this.now = new Date(this.now.getTime() + seconds * 1000)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function activeHoldReducesTrustedAvailable() {
  const model = new ReservationModel()
  model.postVerifiedPayment(10_000)

  const hold = model.createReservation({
    walletId: 'wallet-a',
    orderId: 'order-a',
    amount: 7_000,
    idempotencyKey: 'reservation:order-a',
    payload: { route: 'product' },
  })
  const overReserve = model.createReservation({
    walletId: 'wallet-a',
    orderId: 'order-b',
    amount: 4_000,
    idempotencyKey: 'reservation:order-b',
  })

  assert(hold.ok && hold.code === 'WALLET_RESERVATION_CREATED', 'active hold was not created')
  assert(model.trustedAvailable === 3_000, 'active hold did not reduce trusted available funds')
  assert(!overReserve.ok && overReserve.code === 'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS', 'active hold allowed overspend')
}

function reservationIdempotencyIsPayloadBound() {
  const model = new ReservationModel()
  model.postApprovedAdminCredit(10_000)

  const first = model.createReservation({
    walletId: 'wallet-a',
    orderId: 'order-a',
    amount: 5_000,
    idempotencyKey: 'reservation:same',
    payload: { route: 'sms' },
  })
  const replay = model.createReservation({
    walletId: 'wallet-a',
    orderId: 'order-a',
    amount: 5_000,
    idempotencyKey: 'reservation:same',
    payload: { route: 'sms' },
  })
  const changed = model.createReservation({
    walletId: 'wallet-a',
    orderId: 'order-a',
    amount: 5_000,
    idempotencyKey: 'reservation:same',
    payload: { route: 'telegram' },
  })

  assert(first.ok && first.code === 'WALLET_RESERVATION_CREATED', 'first reservation was not created')
  assert(replay.ok && replay.code === 'WALLET_RESERVATION_IDEMPOTENT_REPLAY', 'exact reservation replay was not idempotent')
  assert(!changed.ok && changed.code === 'WALLET_RESERVATION_IDEMPOTENCY_CONFLICT', 'changed reservation payload reused idempotency key')
  assert(model.reservations.size === 1, 'changed reservation conflict created another hold')
}

function captureReservationThroughWalletEngineModel() {
  const model = new ReservationModel()
  model.postVerifiedPayment(10_000)

  const hold = model.createReservation({
    walletId: 'wallet-a',
    orderId: 'order-a',
    amount: 6_000,
    idempotencyKey: 'reservation:order-a',
  })
  const capture = model.captureReservation({
    reservationId: hold.reservation.id,
    idempotencyKey: 'capture:order-a',
  })
  const replay = model.captureReservation({
    reservationId: hold.reservation.id,
    idempotencyKey: 'capture:order-a',
  })

  assert(capture.ok && capture.code === 'WALLET_RESERVATION_CAPTURED', 'capture reservation through wallet engine failed')
  assert(replay.ok && replay.code === 'WALLET_RESERVATION_CAPTURE_REPLAY', 'capture replay was not idempotent')
  assert(model.trustedConsumedSpend === 6_000, 'capture did not consume trusted spend')
  assert(model.activeHoldTotal() === 0, 'captured reservation still counted as active hold')
  assert(model.trustedAvailable === 4_000, 'captured reservation left wrong trusted availability')
  assert(model.transactions.filter((transaction) => transaction.type === 'purchase').length === 1, 'capture posted more than one purchase row')
}

function releaseDoesNotCreateRefundCredit() {
  const model = new ReservationModel()
  model.postVerifiedPayment(10_000)

  const hold = model.createReservation({
    walletId: 'wallet-a',
    orderId: 'order-a',
    amount: 6_000,
    idempotencyKey: 'reservation:order-a',
  })
  const transactionCountBeforeRelease = model.transactions.length
  const release = model.releaseReservation({ reservationId: hold.reservation.id })
  const replay = model.releaseReservation({ reservationId: hold.reservation.id })
  const releaseTransactions = model.transactions.slice(transactionCountBeforeRelease)

  assert(release.ok && release.code === 'WALLET_RESERVATION_RELEASED', 'active reservation release failed')
  assert(replay.ok && replay.code === 'WALLET_RESERVATION_RELEASE_REPLAY', 'release replay was not idempotent')
  assert(model.trustedAvailable === 10_000, 'reservation release did not restore held availability')
  assert(!releaseTransactions.some((transaction) => ['refund', 'credit', 'deposit'].includes(transaction.type)), 'release does not create refund credit')
}

function capturedReservationCannotBeReleased() {
  const model = new ReservationModel()
  model.postVerifiedPayment(10_000)

  const hold = model.createReservation({
    walletId: 'wallet-a',
    orderId: 'order-a',
    amount: 6_000,
    idempotencyKey: 'reservation:order-a',
  })
  model.captureReservation({
    reservationId: hold.reservation.id,
    idempotencyKey: 'capture:order-a',
  })

  const release = model.releaseReservation({ reservationId: hold.reservation.id })
  assert(!release.ok && release.code === 'WALLET_RESERVATION_ALREADY_CAPTURED', 'captured reservation release created a second restoration path')
}

function expiredReservationCannotCapture() {
  const model = new ReservationModel()
  model.postVerifiedPayment(10_000)

  const hold = model.createReservation({
    walletId: 'wallet-a',
    orderId: 'order-a',
    amount: 6_000,
    idempotencyKey: 'reservation:order-a',
    ttlSeconds: 10,
  })
  model.advance(11)

  const capture = model.captureReservation({
    reservationId: hold.reservation.id,
    idempotencyKey: 'capture:order-a',
  })
  assert(!capture.ok && capture.code === 'WALLET_RESERVATION_EXPIRED', 'expired reservation was captured')
}

function refundRestoresPriorTrustedDebitButNotPrincipal() {
  const model = new ReservationModel()
  model.postVerifiedPayment(10_000)

  const nakedRefund = model.postRefund(5_000)
  assert(!nakedRefund.ok && nakedRefund.restored === 0, 'refund created trusted money without a prior trusted debit')
  assert(model.trustedPrincipal === 10_000, 'refund changed trusted principal')
  assert(model.trustedAvailable === 10_000, 'naked refund changed trusted available')

  const hold = model.createReservation({
    walletId: 'wallet-a',
    orderId: 'order-a',
    amount: 6_000,
    idempotencyKey: 'reservation:order-a',
  })
  model.captureReservation({
    reservationId: hold.reservation.id,
    idempotencyKey: 'capture:order-a',
  })
  const validRefund = model.postRefund(6_000)

  assert(validRefund.ok && validRefund.restored === 6_000, 'refund did not restore prior trusted debit capacity')
  assert(model.trustedPrincipal === 10_000, 'refund increased trusted principal instead of restoring consumed spend')
  assert(model.trustedAvailable === 10_000, 'valid refund did not restore original trusted availability')
}

activeHoldReducesTrustedAvailable()
reservationIdempotencyIsPayloadBound()
captureReservationThroughWalletEngineModel()
releaseDoesNotCreateRefundCredit()
capturedReservationCannotBeReleased()
expiredReservationCannotCapture()
refundRestoresPriorTrustedDebitButNotPrincipal()

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'active holds reduce trusted available funds',
    'reservation idempotency is wallet/order/amount/payload bound',
    'capture reservation through wallet engine posts one purchase and clears the hold',
    'release does not create refund credit',
    'captured reservations cannot be released',
    'expired reservations cannot be captured',
    'refund restores prior trusted debit capacity but never creates trusted principal',
  ],
}, null, 2))
