// Never persist or return supplier payloads. Inspect only known error fields.
const PROVIDERS = new Set(['muabanvia', 'shopclone', 'shopviaclone'])
const SOURCES = new Set(['process-purchase', 'auto-restock', 'manual-restock'])
const BALANCE_CODES = new Set(['INSUFFICIENT_BALANCE', 'INSUFFICIENT_FUNDS', 'LOW_BALANCE', 'NO_BALANCE', 'NOT_ENOUGH_MONEY'])

export function classifySupplierBalanceFailure(response, { confirmedBalance, httpStatus } = {}) {
  if (typeof confirmedBalance === 'number' && Number.isFinite(confirmedBalance) && confirmedBalance <= 0) return 'insufficient_balance'
  // Gateways/timeouts cannot prove that the supplier rejected an order.
  if (typeof httpStatus === 'number' && (httpStatus >= 500 || httpStatus === 408 || httpStatus === 429)) return null
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null
  if (response.status === 'success' || response.success === true) return null
  const code = typeof response.code === 'string' ? response.code.toUpperCase() : ''
  if (BALANCE_CODES.has(code)) return 'insufficient_balance'
  const messages = [response.msg, response.message, response.error].filter(value => typeof value === 'string').map(value => value.slice(0, 1000))
  const insufficient = /\b(?:insufficient|not enough|low|empty|zero)\s+(?:account\s+)?(?:balance|funds|money|credit)\b|\b(?:balance|funds|money|credit)\s+(?:is\s+|are\s+)?(?:insufficient|too low|not enough)\b|kh[oô]ng\s+[dđ][uủ]\s+(?:s[oố]\s+d[uư]|ti[eề]n)|s[oố]\s+d[uư]\s+kh[oô]ng\s+[dđ][uủ]/iu
  return messages.some(message => insufficient.test(message)) ? 'insufficient_balance' : null
}

/** @param {any} admin
 * @param {{provider:string, productGroupId?:string|null, source:string, response?:unknown, confirmedBalance?:number, httpStatus?:number}} options */
export async function recordSupplierBalanceFailure(admin, { provider, productGroupId = null, source, response, confirmedBalance, httpStatus }) {
  if (!PROVIDERS.has(provider) || !SOURCES.has(source)) return false
  if (!classifySupplierBalanceFailure(response, { confirmedBalance, httpStatus })) return false
  try {
    const { error } = await admin.rpc('record_supplier_balance_alert', {
      p_provider: provider,
      p_product_group_id: productGroupId,
      p_source: source,
    })
    if (error) console.error('Supplier balance warning could not be recorded')
    return !error
  } catch { console.error('Supplier balance warning could not be recorded'); return false }
}

export async function resolveSupplierBalanceAlert(admin, { provider, attemptStartedAt }) {
  if (!PROVIDERS.has(provider) || !Number.isFinite(Date.parse(attemptStartedAt))) return false
  // A successful concurrent order must not erase a later insufficient-balance failure.
  try {
    const { error } = await admin.rpc('resolve_supplier_balance_alert', {
      p_provider: provider,
      p_attempt_started_at: attemptStartedAt,
    })
    if (error) console.error('Supplier balance warning could not be resolved')
    return !error
  } catch { console.error('Supplier balance warning could not be resolved'); return false }
}
