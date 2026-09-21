function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const READ_ONLY_ROUTES = new Set(['/orders', '/support', '/account', '/wallet'])
const PURCHASE_ROUTES = new Set(['/products/checkout', '/sms/checkout', '/social-boost/order', '/telegram-stars', '/gift-cards/checkout'])

function routeAccessDecision({ path, accountSuspended, authenticated = true }) {
  if (!authenticated) return { allow: false, code: 'AUTH_REQUIRED' }
  if (!accountSuspended) return { allow: true, code: 'ACTIVE_ACCESS' }
  if (READ_ONLY_ROUTES.has(path)) return { allow: true, code: 'FROZEN_READ_ONLY_ACCESS' }
  if (PURCHASE_ROUTES.has(path)) return { allow: false, code: 'FROZEN_PURCHASE_BLOCKED' }
  return { allow: true, code: 'FROZEN_GENERAL_ACCESS' }
}

function orderHistoryDecision({ accountSuspended, orderStatus, credentials }) {
  const completed = orderStatus === 'completed'
  const hasCredentials = Array.isArray(credentials) && credentials.length > 0
  return {
    canViewOrder: true,
    canCopyCredentials: completed && hasCredentials,
    canDownloadCredentials: completed && hasCredentials,
    showPurchaseAgain: !accountSuspended && completed,
    banner: accountSuspended ? 'SPENDING_PAUSED_SUPPORT_AVAILABLE' : null,
  }
}

function supportDecision({ accountSuspended }) {
  return {
    canOpenSupport: true,
    canSubmitTicket: true,
    incidentBanner: accountSuspended ? 'WALLET_REVIEW_SPENDING_PAUSED' : null,
  }
}

assert(routeAccessDecision({ path: '/orders', accountSuspended: true }).code === 'FROZEN_READ_ONLY_ACCESS', 'frozen user could not open order history')
assert(routeAccessDecision({ path: '/support', accountSuspended: true }).code === 'FROZEN_READ_ONLY_ACCESS', 'frozen user could not open support')
assert(routeAccessDecision({ path: '/products/checkout', accountSuspended: true }).code === 'FROZEN_PURCHASE_BLOCKED', 'frozen user could open product checkout')
assert(routeAccessDecision({ path: '/sms/checkout', accountSuspended: true }).code === 'FROZEN_PURCHASE_BLOCKED', 'frozen user could open SMS checkout')
assert(routeAccessDecision({ path: '/orders', accountSuspended: false }).code === 'ACTIVE_ACCESS', 'active user order history was blocked')
assert(routeAccessDecision({ path: '/orders', accountSuspended: false, authenticated: false }).code === 'AUTH_REQUIRED', 'unauthenticated access was allowed')

const completedFrozen = orderHistoryDecision({
  accountSuspended: true,
  orderStatus: 'completed',
  credentials: [{ username: 'user1', password: 'pass1' }],
})
assert(completedFrozen.canViewOrder, 'frozen user could not view completed order')
assert(completedFrozen.canCopyCredentials && completedFrozen.canDownloadCredentials, 'completed credentials were hidden from frozen user history')
assert(!completedFrozen.showPurchaseAgain, 'frozen user still saw purchase-again prompt')
assert(completedFrozen.banner === 'SPENDING_PAUSED_SUPPORT_AVAILABLE', 'frozen order history did not show spending-paused banner')

const pendingFrozen = orderHistoryDecision({
  accountSuspended: true,
  orderStatus: 'processing',
  credentials: [{ username: 'not-ready', password: 'secret' }],
})
assert(pendingFrozen.canViewOrder, 'frozen user could not view processing order record')
assert(!pendingFrozen.canCopyCredentials && !pendingFrozen.canDownloadCredentials, 'unfinished credentials were exposed to frozen user')

const activeCompleted = orderHistoryDecision({
  accountSuspended: false,
  orderStatus: 'completed',
  credentials: [{ username: 'user1', password: 'pass1' }],
})
assert(activeCompleted.showPurchaseAgain, 'active completed order did not show purchase-again prompt')

const support = supportDecision({ accountSuspended: true })
assert(support.canOpenSupport && support.canSubmitTicket, 'frozen user support access was blocked')
assert(support.incidentBanner === 'WALLET_REVIEW_SPENDING_PAUSED', 'frozen support page lacked review banner')

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    'frozen users can open read-only order history and support routes',
    'frozen users cannot open purchase/checkout routes',
    'completed order credentials remain available in history',
    'unfinished credentials are not revealed',
    'purchase-again prompts are hidden while frozen',
    'support remains available with a wallet-review banner',
  ],
}, null, 2))
