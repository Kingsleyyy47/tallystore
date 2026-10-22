import { supabase } from '@/lib/supabase'

export type PocketfiSearchType = 'reference' | 'email' | 'account_number'
export type PocketfiPaymentStatus = 'paid_and_credited' | 'paid_credit_missing' | 'pending' | 'failed' | 'no_webhook' | 'needs_review'
export type PocketfiPaymentRow = {
  result_key: string
  reference: string | null
  customer_id: string | null
  customer_email: string | null
  account_number: string | null
  received_at: string | null
  amount_ngn: number | null
  expected_credit_ngn: number | null
  fee_ngn: number | null
  fee_note: string | null
  webhook_state: 'verified_success' | 'verified_failed' | 'verified_pending' | 'unverified' | 'not_found'
  credit_state: 'credited' | 'not_found' | 'review' | 'unavailable'
  status: PocketfiPaymentStatus
  transaction_id: string | null
  credited_at: string | null
  credited_amount_ngn: number | null
  reasons: string[]
  can_flag: boolean
}
export type PocketfiPaymentCheck = {
  check_id: string
  checked_at: string
  search_type: PocketfiSearchType
  search: string
  results: PocketfiPaymentRow[]
  truncated: boolean
}
export type PocketfiPaymentReview = {
  id: string
  created_at: string
  flagged_by: string
  flagged_by_email: string | null
  note: string
  status: 'pending' | 'reviewed'
  snapshot: PocketfiPaymentRow
  reviewed_at: string | null
  reviewed_by: string | null
  review_note: string | null
}
export type PocketfiReviewQueue = { reviews: PocketfiPaymentReview[]; truncated: boolean }
type RequestOptions = { expectedUserId: string; signal?: AbortSignal }
const REQUEST_DEADLINE_MS = 15_000
const statuses = new Set(['paid_and_credited', 'paid_credit_missing', 'pending', 'failed', 'no_webhook', 'needs_review'])
const webhookStates = new Set(['verified_success', 'verified_failed', 'verified_pending', 'unverified', 'not_found'])
const creditStates = new Set(['credited', 'not_found', 'review', 'unavailable'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max
const nullableText = (value: unknown, max = 500): value is string | null => value === null || text(value, max)
const nullableMoney = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0
const date = (value: unknown): value is string => text(value, 64) && Number.isFinite(Date.parse(value))
const nullableDate = (value: unknown): value is string | null => value === null || date(value)
const positiveAmount = (value: unknown): value is number => typeof value === 'number' && value > 0
  && Number.isSafeInteger(Math.round(value * 100))
const sameAmount = (first: unknown, second: unknown): boolean => positiveAmount(first) && positiveAmount(second)
  && Math.round(first * 100) === Math.round(second * 100)

export function parsePocketfiPaymentRow(value: unknown): PocketfiPaymentRow {
  if (!record(value) || !text(value.result_key, 500) || !value.result_key
    || !nullableText(value.reference, 500) || !nullableText(value.customer_id, 80)
    || !nullableText(value.customer_email, 320) || !nullableText(value.account_number, 80)
    || !nullableDate(value.received_at) || !nullableDate(value.credited_at)
    || !nullableMoney(value.amount_ngn) || !nullableMoney(value.expected_credit_ngn)
    || !nullableMoney(value.fee_ngn) || !nullableMoney(value.credited_amount_ngn)
    || !nullableText(value.fee_note, 1000) || !nullableText(value.transaction_id, 100)
    || !webhookStates.has(String(value.webhook_state)) || !creditStates.has(String(value.credit_state))
    || !statuses.has(String(value.status)) || typeof value.can_flag !== 'boolean'
    || !Array.isArray(value.reasons) || value.reasons.length > 20 || !value.reasons.every(reason => text(reason, 1000))) {
    throw new Error('Payment details could not be verified. Please recheck.')
  }
  if (value.status === 'paid_and_credited' && (value.webhook_state !== 'verified_success' || value.credit_state !== 'credited'
    || !text(value.transaction_id, 100) || !uuid.test(value.transaction_id)
    || !sameAmount(value.amount_ngn, value.expected_credit_ngn) || !sameAmount(value.amount_ngn, value.credited_amount_ngn))
    || value.status === 'paid_credit_missing' && (value.webhook_state !== 'verified_success' || value.credit_state !== 'not_found'
      || !sameAmount(value.amount_ngn, value.expected_credit_ngn))
    || value.status === 'failed' && value.webhook_state !== 'verified_failed'
    || value.status === 'pending' && value.webhook_state !== 'verified_pending') {
    throw new Error('Payment details could not be verified. Please recheck.')
  }
  // Deliberately pick the public fields. A later server addition cannot leak through copying or the UI.
  return {
    result_key: value.result_key, reference: value.reference, customer_id: value.customer_id,
    customer_email: value.customer_email, account_number: value.account_number,
    received_at: value.received_at, amount_ngn: value.amount_ngn,
    expected_credit_ngn: value.expected_credit_ngn, fee_ngn: value.fee_ngn, fee_note: value.fee_note,
    webhook_state: value.webhook_state as PocketfiPaymentRow['webhook_state'],
    credit_state: value.credit_state as PocketfiPaymentRow['credit_state'], status: value.status as PocketfiPaymentStatus,
    transaction_id: value.transaction_id, credited_at: value.credited_at,
    credited_amount_ngn: value.credited_amount_ngn, reasons: value.reasons as string[], can_flag: value.can_flag,
  }
}

export function parsePocketfiPaymentCheck(value: unknown): PocketfiPaymentCheck {
  if (!record(value) || !text(value.check_id) || !uuid.test(value.check_id) || !date(value.checked_at)
    || !['reference', 'email', 'account_number'].includes(String(value.search_type)) || !text(value.search, 500)
    || !Array.isArray(value.results) || value.results.length > 50 || typeof value.truncated !== 'boolean') {
    throw new Error('Payment details could not be verified. Please recheck.')
  }
  return { check_id: value.check_id, checked_at: value.checked_at, search_type: value.search_type as PocketfiSearchType,
    search: value.search, results: value.results.map(parsePocketfiPaymentRow), truncated: value.truncated }
}

export function parsePocketfiReviewQueue(value: unknown): PocketfiReviewQueue {
  if (!record(value) || !Array.isArray(value.reviews) || value.reviews.length > 50 || typeof value.truncated !== 'boolean') {
    throw new Error('The review queue is unavailable. Please retry.')
  }
  const reviews = value.reviews.map(item => {
    if (!record(item) || !text(item.id) || !uuid.test(item.id) || !date(item.created_at)
      || !text(item.flagged_by, 80) || !nullableText(item.flagged_by_email, 320) || !text(item.note, 1000)
      || !['pending', 'reviewed'].includes(String(item.status)) || !nullableDate(item.reviewed_at)
      || !nullableText(item.reviewed_by, 80) || !nullableText(item.review_note, 1000)) {
      throw new Error('The review queue is unavailable. Please retry.')
    }
    return { id: item.id, created_at: item.created_at, flagged_by: item.flagged_by,
      flagged_by_email: item.flagged_by_email, note: item.note, status: item.status as PocketfiPaymentReview['status'],
      snapshot: parsePocketfiPaymentRow(item.snapshot), reviewed_at: item.reviewed_at,
      reviewed_by: item.reviewed_by, review_note: item.review_note }
  })
  return { reviews, truncated: value.truncated }
}

export function validatePocketfiSearch(type: PocketfiSearchType, value: string): string {
  const cleaned = value.trim()
  if (type === 'email' && (cleaned.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned))) throw new Error('Enter the customer’s full email address (up to 254 characters).')
  if (type === 'account_number' && !/^\d{6,24}$/.test(cleaned)) throw new Error('Enter the full receiving account number, using digits only.')
  if (!cleaned || cleaned.length > 256 || [...cleaned].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || type === 'reference' && cleaned.length < 3) throw new Error('Enter a complete payment reference, email or account number.')
  return type === 'email' ? cleaned.toLowerCase() : cleaned
}

async function request(name: string, args: Record<string, unknown>, options: RequestOptions): Promise<unknown> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abortListener: (() => void) | undefined
  const stopped = new Promise<never>((_, reject) => {
    const cancel = () => { controller.abort(); reject(new Error('cancelled')) }
    if (options.signal?.aborted) cancel()
    else if (options.signal) { options.signal.addEventListener('abort', cancel, { once: true }); abortListener = cancel }
  })
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new Error('deadline')) }, REQUEST_DEADLINE_MS)
  })
  try {
    return await Promise.race([stopped, deadline, (async () => {
      if (controller.signal.aborted) throw new Error('cancelled')
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error || !session?.access_token || session.user?.id !== options.expectedUserId) throw new Error('unauthorized')
      if (controller.signal.aborted) throw new Error('cancelled')
      const result = await supabase.rpc(name, args).abortSignal(controller.signal)
      if (result.error) throw new Error(result.error.code === '42501' ? 'unauthorized'
        : result.error.code === 'P0001' && result.error.message === 'Too many payment checks. Please wait a minute' ? 'rate_limit' : 'unavailable')
      if (controller.signal.aborted) throw new Error('cancelled')
      return result.data
    })()])
  } catch (error) {
    if (error instanceof Error && error.message === 'unauthorized') throw new Error('You do not have permission to check these payments. Sign in again if your access changed.')
    if (error instanceof Error && error.message === 'rate_limit') throw new Error('Too many payment checks. Please wait a minute before rechecking.')
    if (error instanceof Error && error.message === 'deadline') throw new Error('The payment check timed out. Please retry.')
    throw new Error('Payment checking is unavailable. Please retry.')
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (abortListener) options.signal?.removeEventListener('abort', abortListener)
  }
}

export async function checkPocketfiPayments(type: PocketfiSearchType, value: string, options: RequestOptions): Promise<PocketfiPaymentCheck> {
  const search = validatePocketfiSearch(type, value)
  const response = await request('staff_check_pocketfi_payments', { p_search_type: type, p_search: search, p_limit: 50 }, options)
  if (record(response) && response.error === 'POCKETFI_CHECK_UNAVAILABLE') throw new Error('Payment evidence is temporarily unavailable. Please retry.')
  const parsed = parsePocketfiPaymentCheck(response)
  if (parsed.search_type !== type || parsed.search !== search) throw new Error('The result did not match this search. Please recheck.')
  return parsed
}

export async function flagPocketfiPayment(checkId: string, resultKey: string, note: string, options: RequestOptions): Promise<{ review_id: string; already_flagged: boolean }> {
  if (!uuid.test(checkId) || !resultKey || note.trim().length < 3 || note.trim().length > 1000) throw new Error('Add a note for the admin (3–1,000 characters).')
  const value = await request('staff_flag_pocketfi_payment', { p_check_id: checkId, p_result_key: resultKey, p_note: note.trim() }, options)
  if (!record(value) || !text(value.review_id) || !uuid.test(value.review_id)
    || value.status !== 'pending' || typeof value.already_flagged !== 'boolean') throw new Error('The review flag could not be confirmed. Recheck before trying again.')
  return { review_id: value.review_id, already_flagged: value.already_flagged }
}

export async function listPocketfiReviews(status: 'pending' | 'reviewed', options: RequestOptions): Promise<PocketfiReviewQueue> {
  return parsePocketfiReviewQueue(await request('admin_list_pocketfi_payment_reviews', { p_status: status, p_limit: 50 }, options))
}

export async function resolvePocketfiReview(reviewId: string, note: string, options: RequestOptions): Promise<void> {
  if (!uuid.test(reviewId) || note.trim().length < 3 || note.trim().length > 1000) throw new Error('Add a review note (3–1,000 characters).')
  const value = await request('admin_resolve_pocketfi_payment_review', { p_review_id: reviewId, p_note: note.trim() }, options)
  if (!record(value) || value.review_id !== reviewId || value.status !== 'reviewed') throw new Error('The review update could not be confirmed. Reload the queue before trying again.')
}

export const pocketfiStatusLabels: Record<PocketfiPaymentStatus, string> = {
  paid_and_credited: 'Paid and credited', paid_credit_missing: 'Paid — credit missing', pending: 'Pending',
  failed: 'Failed', no_webhook: 'No webhook found', needs_review: 'Needs review',
}
export function pocketfiNgn(value: number | null): string {
  return value === null ? 'Not confirmed' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 }).format(value)
}
export function pocketfiNigeriaDate(value: string | null): string {
  return value === null ? 'Not recorded' : new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
  }).format(new Date(value)) + ' WAT'
}
export function pocketfiCustomerSummary(row: PocketfiPaymentRow, checkedAt?: string): string {
  const messages: Record<PocketfiPaymentStatus, string> = {
    paid_and_credited: `Payment confirmed and ${pocketfiNgn(row.credited_amount_ngn)} credited to your TallyStore wallet.`,
    paid_credit_missing: 'Your payment is confirmed. The wallet credit needs review; please contact TallyStore support.',
    pending: 'Your payment is awaiting confirmation. Please do not pay again while it is being checked.',
    failed: 'The payment provider reported this payment as failed. Please contact TallyStore support if your bank debited you.',
    no_webhook: 'We have not received a verified payment confirmation. This does not mean the payment failed. Please contact TallyStore support if your bank debited you.',
    needs_review: 'This payment needs further review. Please contact TallyStore support and do not pay again while it is being checked.',
  }
  return ['TallyStore — PocketFi payment check', checkedAt ? `Checked: ${pocketfiNigeriaDate(checkedAt)}` : null,
    row.reference ? `Reference: ${row.reference}` : null,
    row.amount_ngn === null ? null : `Payment amount: ${pocketfiNgn(row.amount_ngn)}`, messages[row.status]].filter(Boolean).join('\n')
}
