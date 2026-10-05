// Owner-only observations for external partner orders. This module has no
// financial mutation or provider purchase operation.
type Admin = any
type Result = { body: Record<string, unknown>; status: number }
type ReadResult = { data: any; error: unknown }
type Deps = {
  daisyStatus: (id: string) => Promise<unknown>
  smmStatus: (id: string) => Promise<unknown>
  bitrefillInvoice: (id: string) => Promise<unknown>
  istarOrder: (id: string) => Promise<unknown>
}
const OWNER = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const SOURCES: Record<string, string> = {
  sms: 'daisy', social_boost: 'smm', giftcards: 'bitrefill', telegram_stars: 'istar',
}
const PAGE_SIZE = 50
const POLL_TIMEOUT_MS = 8_000
const error = (code: string, status: number): Result => ({ body: { success: false, code }, status })

function matchingBoundId(journal: any, order: any): string | null {
  const id = journal?.fulfillment_id
  return order && order.id === journal.order_id && journal.partner_id === order.partner_id
    && journal.section === order.item_type
    && Number(journal.amount_ngn) === Number(order.amount_ngn)
    && SOURCES[journal.section] === journal.fulfillment_source
    && order.fulfillment_source === journal.fulfillment_source
    && order.fulfillment_id === id
    && typeof id === 'string' && PROVIDER_ID.test(id) ? id : null
}
function caseSummary(journal: any, order: any) {
  return { order_id: journal.order_id, partner_id: journal.partner_id,
    section: journal.section, state: journal.state,
    order_status: typeof order?.status === 'string' ? order.status : 'missing',
    amount_ngn: Number(journal.amount_ngn), funding_type: journal.funding_type,
    claimed_at: journal.claimed_at, created_at: journal.created_at,
    probe_available: Boolean(matchingBoundId(journal, order)),
  }
}
function ownerAllowed(ownerId: string): boolean { return ownerId === OWNER }
function reviewable(journal: any, order: any): boolean {
  return journal?.state === 'sending' || journal?.state === 'unknown'
    || journal?.state === 'accepted' && ['active', 'processing'].includes(String(order?.status))
}

export async function listPartnerExternalReconciliationCases(admin: Admin, ownerId: string,
  body: Record<string, unknown>): Promise<Result> {
  if (!ownerAllowed(ownerId)) return error('PARTNER_OWNER_REQUIRED', 403)
  const page = body.page === undefined ? 0 : body.page
  if (!Number.isSafeInteger(page) || Number(page) < 0 || Number(page) > 1000) return error('INVALID_REQUEST', 400)
  try {
    const start = Number(page) * PAGE_SIZE
    const { data: journals, error: journalError } = await withDeadline<ReadResult>(() => admin.from('api_partner_external_orders')
      .select('order_id,partner_id,section,state,amount_ngn,funding_type,fulfillment_source,fulfillment_id,claimed_at,created_at')
      .in('state', ['sending', 'unknown'])
      .order('created_at', { ascending: false }).order('order_id', { ascending: false })
      .range(start, start + PAGE_SIZE))
    if (journalError || !Array.isArray(journals)) return error('PARTNER_API_UNAVAILABLE', 503)
    const ids = journals.map((row: any) => row.order_id).filter((id: unknown) => typeof id === 'string' && UUID.test(id))
    let orders: any[] = []
    if (ids.length) {
      const read = await withDeadline<ReadResult>(() => admin.from('api_partner_orders')
        .select('id,partner_id,status,item_type,amount_ngn,fulfillment_source,fulfillment_id')
        .in('id', ids))
      if (read.error || !Array.isArray(read.data)) return error('PARTNER_API_UNAVAILABLE', 503)
      orders = read.data
    }
    const byId = new Map(orders.map(order => [order.id, order]))
    const cases = journals.slice(0, PAGE_SIZE)
      .map((journal: any) => caseSummary(journal, byId.get(journal.order_id)))
    return { body: { success: true, cases, next_page: journals.length > PAGE_SIZE ? Number(page) + 1 : null }, status: 200 }
  } catch { return error('PARTNER_API_UNAVAILABLE', 503) }
}

function observed(source: string, response: unknown, id: string): string {
  if (source === 'daisy') {
    if (typeof response !== 'string') return 'inconclusive'
    if (/^STATUS_OK:[A-Za-z0-9_-]{3,32}$/.test(response)) return 'reported_completed'
    if (response.startsWith('STATUS_WAIT')) return 'reported_pending'
    if (response === 'STATUS_CANCEL') return 'reported_failure'
    return 'inconclusive' // NO_ACTIVATION alone never proves no paid send.
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) return 'inconclusive'
  const row = response as Record<string, unknown>
  if (source === 'bitrefill' && row.id !== id || source === 'istar' && row.order_id !== id) return 'inconclusive'
  const status = String(row.status || '').toLowerCase()
  if (source === 'bitrefill') {
    if (status === 'complete') return 'invoice_complete_requires_order_review'
    if (['unpaid', 'pending', 'payment_detected', 'payment_confirmed'].includes(status)) return 'reported_pending'
    if (['denied', 'payment_error'].includes(status)) return 'reported_failure'
    return 'inconclusive'
  }
  if (status === 'completed') return 'reported_completed'
  if (['pending', 'processing', 'in progress', 'partial'].includes(status)) return 'reported_pending'
  if (['failed', 'cancelled', 'canceled'].includes(status)) return 'reported_failure'
  return 'inconclusive'
}
async function withDeadline<T>(call: () => PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([Promise.resolve().then(call),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('probe timeout')), POLL_TIMEOUT_MS) })])
  } finally { if (timer) clearTimeout(timer) }
}

export async function probePartnerExternalReconciliationCase(admin: Admin, ownerId: string,
  body: Record<string, unknown>, deps: Deps): Promise<Result> {
  if (!ownerAllowed(ownerId)) return error('PARTNER_OWNER_REQUIRED', 403)
  const orderId = body.order_id
  if (typeof orderId !== 'string' || !UUID.test(orderId)) return error('INVALID_ORDER', 400)
  try {
    const { data: journal, error: journalError } = await withDeadline<ReadResult>(() => admin.from('api_partner_external_orders')
      .select('order_id,partner_id,section,state,amount_ngn,funding_type,fulfillment_source,fulfillment_id,claimed_at,created_at')
      .eq('order_id', orderId).maybeSingle())
    if (journalError) return error('PARTNER_API_UNAVAILABLE', 503)
    if (!journal) return error('ORDER_NOT_FOUND', 404)
    const { data: order, error: orderError } = await withDeadline<ReadResult>(() => admin.from('api_partner_orders')
      .select('id,partner_id,status,item_type,amount_ngn,fulfillment_source,fulfillment_id')
      .eq('id', orderId).eq('partner_id', journal.partner_id).maybeSingle())
    if (orderError) return error('PARTNER_API_UNAVAILABLE', 503)
    if (!reviewable(journal, order)) return error('CASE_NOT_REVIEWABLE', 409)
    const id = matchingBoundId(journal, order)
    const summary = caseSummary(journal, order)
    if (!id) return { body: { success: true, case: summary,
      observation: 'provider_id_unavailable', financial_decision: 'none' }, status: 200 }
    let response: unknown
    try {
      response = await withDeadline(() => journal.fulfillment_source === 'daisy' ? deps.daisyStatus(id)
        : journal.fulfillment_source === 'smm' ? deps.smmStatus(id)
          : journal.fulfillment_source === 'bitrefill' ? deps.bitrefillInvoice(id)
            : deps.istarOrder(id))
    } catch { return { body: { success: true, case: summary,
      observation: 'inconclusive', financial_decision: 'none' }, status: 200 } }
    return { body: { success: true, case: summary,
      observation: observed(journal.fulfillment_source, response, id), financial_decision: 'none' }, status: 200 }
  } catch { return error('PARTNER_API_UNAVAILABLE', 503) }
}
