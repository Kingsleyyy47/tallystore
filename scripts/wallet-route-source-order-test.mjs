import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertOrder(src, earlier, later, message) {
  const earlierIndex = src.indexOf(earlier)
  const laterIndex = src.indexOf(later)
  assert(earlierIndex !== -1, `${message}: missing earlier marker ${earlier}`)
  assert(laterIndex !== -1, `${message}: missing later marker ${later}`)
  assert(earlierIndex < laterIndex, message)
}

const product = read('supabase/functions/process-purchase/index.ts')
const protectedPurchaseRouteSources = [
  ['process-purchase', product],
  ['smm-create-order', read('supabase/functions/smm-create-order/index.ts')],
  ['smsbus', read('supabase/functions/smsbus/index.ts')],
  ['telegram-stars', read('supabase/functions/telegram-stars/index.ts')],
  ['purchase-bills', read('supabase/functions/purchase-bills/index.ts')],
  ['purchase-bitrefill', read('supabase/functions/purchase-bitrefill/index.ts')],
]
for (const [label, src] of protectedPurchaseRouteSources) {
  for (const forbidden of [
    "type: 'release_hold'",
    'type: "release_hold"',
    "type: 'capture_reservation'",
    'type: "capture_reservation"',
    'release_wallet_hold',
    'capture_wallet_reservation',
  ]) {
    assert(!src.includes(forbidden), `${label} must not mix debit-first refunds with financial hold release/capture operation ${forbidden}`)
  }
}
assert(product.includes('const liveAccountFulfillmentEnabled = false'), 'live account supplier fallback must remain hard-paused')
assert(product.includes('PURCHASE_LEDGER_ORPHANED'), 'product purchases must block orphaned purchase-ledger retries')
assert(product.includes("'authorize_product_purchase'"), 'product route must authorize through the reserve-first database boundary')
assert(product.includes("'complete_product_purchase'"), 'product route must complete through the atomic capture boundary')
assertOrder(product, 'await assertPurchasingCustomer(supabaseAdmin, user.id, req)', "'authorize_product_purchase'", 'product route must check suspension/device ban before financial authorization')
assertOrder(product, "'authorize_product_purchase'", "const { data: purchasedAccounts", 'product route must reserve trusted funds and inventory before loading credentials')
assertOrder(product, "const { data: purchasedAccounts", 'const accountDetails = {', 'product route must assemble credentials only after the reservation is committed')
assertOrder(product, 'const accountDetails = {', "'complete_product_purchase'", 'product route must capture and persist credentials through the atomic completion boundary')
assert(!product.includes("type: 'purchase'"), 'product route must not directly post a debit outside the product completion RPC')

const smm = read('supabase/functions/smm-create-order/index.ts')
assert(smm.includes("Deno.env.get('SMM_ORDERS_ENABLED')"), 'SMM order creation must remain default-paused by SMM_ORDERS_ENABLED')
assert(smm.includes("code: 'SMM_ORDERS_PAUSED'"), 'SMM order creation must return stable SMM_ORDERS_PAUSED denial code')
assert(smm.includes('SMM_PURCHASE_LEDGER_ORPHANED'), 'SMM purchases must block orphaned purchase-ledger retries')
assert(smm.includes('if (orphanedPurchaseTx && !existingOrder)'), 'SMM orphaned purchase-ledger block must not reject an exact existing-order replay')
assertOrder(smm, 'await assertPurchasingCustomer(supabaseAdmin, user.id, req)', 'const debitResult = await applyWalletTransaction', 'SMM route must check suspension/device ban before wallet debit')
assertOrder(smm, 'const debitResult = await applyWalletTransaction', ".from('smm_orders')\n      .insert(orderData)", 'SMM route must create local order only after wallet debit')
assertOrder(smm, ".from('smm_orders')\n      .insert(orderData)", 'const panelResponse = await smmClient.createOrder', 'SMM supplier call must happen only after local order exists')
assertOrder(smm, 'const debitResult = await applyWalletTransaction', 'const smmClient = createSmmPanelClient()', 'SMM route must complete wallet debit before the provider client can be used')

const sms = read('supabase/functions/smsbus/index.ts')
assert(sms.includes("Deno.env.get('SMS_OTP_ENABLED')"), 'SMS OTP creation must remain default-paused by SMS_OTP_ENABLED')
assert(sms.includes("code: 'SMS_OTP_PAUSED'"), 'SMS OTP creation must return stable SMS_OTP_PAUSED denial code')
assert(sms.includes('SMS_PURCHASE_LEDGER_ORPHANED'), 'SMS purchases must block orphaned purchase-ledger retries')
assert(sms.includes('if (orphanedPurchaseTx && !existing)'), 'SMS orphaned purchase-ledger block must not reject an exact existing-order replay')
assertOrder(sms, 'await assertPurchasingCustomer(admin, userId, req)', 'debit = await debitWallet', 'SMS route must check suspension/device ban before wallet debit')
assertOrder(sms, 'debit = await debitWallet', 'pending_provider_allocation: true', 'SMS route must create pending local order after wallet debit')
assertOrder(sms, 'pending_provider_allocation: true', 'number = await daisyGetNumber', 'SMS Daisy allocation must happen only after pending local order exists')
assertOrder(sms, 'debit = await debitWallet', 'number = await daisyGetNumber', 'SMS route must complete wallet debit before DaisySMS allocation')
assertOrder(sms, 'number = await daisyGetNumber', "status: 'active'", 'SMS order must become active only after provider allocation succeeds')

const telegram = read('supabase/functions/telegram-stars/index.ts')
const telegramPage = read('src/pages/TelegramStarsPage.tsx')
const telegramIdempotencyMigration = read('supabase/migrations/20260919022000_add_telegram_order_idempotency.sql')
const starHandler = telegram.indexOf('async function handleCreateStarsOrder')
const premiumHandler = telegram.indexOf('async function handleCreatePremiumOrder')
assert(starHandler > -1, 'Telegram Stars handler missing')
assert(premiumHandler > -1, 'Telegram Premium handler missing')
assert(telegram.includes("Deno.env.get('TELEGRAM_ORDERS_ENABLED')"), 'Telegram order creation must remain default-paused by TELEGRAM_ORDERS_ENABLED')
assert(telegram.includes("code: 'TELEGRAM_ORDERS_PAUSED'"), 'Telegram order creation must return stable TELEGRAM_ORDERS_PAUSED denial code')
assert(telegramPage.includes("createTelegramIdempotencyKey('stars')"), 'Telegram Stars frontend must send a per-attempt idempotency key')
assert(telegramPage.includes("createTelegramIdempotencyKey('premium')"), 'Telegram Premium frontend must send a per-attempt idempotency key')
assert(telegramIdempotencyMigration.includes('ADD COLUMN IF NOT EXISTS idempotency_key text'), 'Telegram orders must have an idempotency_key column')
assert(telegramIdempotencyMigration.includes('idx_telegram_orders_user_idempotency_key_unique'), 'Telegram orders must enforce per-user idempotency uniqueness')
assert(telegram.includes('function normalizeIdempotencyKey'), 'Telegram route must validate client idempotency keys')
assert(telegram.includes("code: 'IDEMPOTENCY_REQUEST_CONFLICT'"), 'Telegram route must reject changed request contents under the same idempotency key')
assert(telegram.includes("code: 'TELEGRAM_PURCHASE_LEDGER_ORPHANED'"), 'Telegram route must block orphaned debits without matching order evidence')
assert(telegram.includes('source_debit_idempotency_key: originalDebitKey'), 'Telegram refunds must carry original debit idempotency provenance')
assert(telegram.includes('original_purchase_idempotency_key: originalDebitKey'), 'Telegram refunds must carry original purchase idempotency provenance')
assertOrder(telegram.slice(starHandler), 'const idempotencyKey = normalizeIdempotencyKey(body.idempotency_key)', "eq('idempotency_key', idempotencyKey)", 'Telegram Stars must validate and query idempotency before order insert')
assertOrder(telegram.slice(starHandler), "eq('idempotency_key', idempotencyKey)", "user_id: userId, reference, order_type: 'stars'", 'Telegram Stars must replay existing idempotency key before creating another order')
assertOrder(telegram.slice(starHandler), "eq('idempotency_key', `telegram:purchase:${idempotencyKey}`)", "user_id: userId, reference, order_type: 'stars'", 'Telegram Stars must check orphaned purchase debit before creating a new order')
assertOrder(telegram.slice(premiumHandler), 'const idempotencyKey = normalizeIdempotencyKey(body.idempotency_key)', "eq('idempotency_key', idempotencyKey)", 'Telegram Premium must validate and query idempotency before order insert')
assertOrder(telegram.slice(premiumHandler), "eq('idempotency_key', idempotencyKey)", "user_id: userId, reference, order_type: 'premium'", 'Telegram Premium must replay existing idempotency key before creating another order')
assertOrder(telegram.slice(premiumHandler), "eq('idempotency_key', `telegram:purchase:${idempotencyKey}`)", "user_id: userId, reference, order_type: 'premium'", 'Telegram Premium must check orphaned purchase debit before creating a new order')
assertOrder(telegram.slice(starHandler), "order_type: 'stars'", 'await deductWallet(admin, userId, priceNgn, reference', 'Telegram Stars must create local order before wallet debit')
assertOrder(telegram.slice(starHandler), 'await deductWallet(admin, userId, priceNgn, reference', "const istarOrder = await istarPost('/orders/star'", 'Telegram Stars must debit wallet before iStar dispatch')
assertOrder(telegram.slice(starHandler), 'await assertPurchasingCustomer(admin, userId, req)', 'await deductWallet(admin, userId, priceNgn, reference', 'Telegram Stars must check suspension/device ban before wallet debit')
assertOrder(telegram.slice(starHandler), "error_message: err?.message || 'Wallet debit failed before supplier dispatch'", "const istarOrder = await istarPost('/orders/star'", 'Telegram Stars must preserve debit failure evidence before any iStar dispatch path')
assertOrder(telegram.slice(premiumHandler), "order_type: 'premium'", 'await deductWallet(admin, userId, chargeNgn, reference', 'Telegram Premium must create local order before wallet debit')
assertOrder(telegram.slice(premiumHandler), 'await deductWallet(admin, userId, chargeNgn, reference', "const istarOrder = await istarPost('/orders/premium'", 'Telegram Premium must debit wallet before iStar dispatch')
assertOrder(telegram.slice(premiumHandler), 'await assertPurchasingCustomer(admin, userId, req)', 'await deductWallet(admin, userId, chargeNgn, reference', 'Telegram Premium must check suspension/device ban before wallet debit')
assertOrder(telegram.slice(premiumHandler), "error_message: err?.message || 'Wallet debit failed before supplier dispatch'", "const istarOrder = await istarPost('/orders/premium'", 'Telegram Premium must preserve debit failure evidence before any iStar dispatch path')
assert(!telegram.includes(".from('telegram_orders').delete()"), 'Telegram denied/debit-failed orders must not be deleted because they are incident evidence')
assert(telegram.includes('Wallet debit failed before supplier dispatch'), 'Telegram debit failure must preserve failed local order evidence')

const orderHistoryData = read('src/lib/supabase.ts')
const orderHistoryPage = read('src/pages/OrderHistoryPage.tsx')
assert(orderHistoryData.includes('function sanitizeOrderHistoryCredentialVisibility'), 'order history must sanitize credential visibility at data boundary')
assert(orderHistoryData.includes("String(order?.status || '').toLowerCase() === 'completed'"), 'order history sanitizer must preserve credentials only for completed orders')
assert(orderHistoryData.includes('(data || []).map(sanitizeOrderHistoryCredentialVisibility)'), 'getUserOrders must apply credential sanitizer')
assert(orderHistoryPage.includes('function isCredentialVisibleOrder'), 'OrderHistoryPage must centralize credential visibility')
assert(orderHistoryPage.includes('if (!isCredentialVisibleOrder(order)) return []'), 'OrderHistoryPage must suppress credentials for non-completed orders')
assert(orderHistoryPage.includes('Credentials are only available after the order is completed.'), 'OrderHistoryPage must tell users credentials are completed-only')

console.log(JSON.stringify({
  ok: true,
  routes: [
    'process-purchase',
    'smm-create-order',
    'smsbus create-otp',
    'telegram-stars create-stars-order',
    'telegram-stars create-premium-order',
    'order-history credential reveal',
  ],
  assertions: [
    'purchase permission checks precede wallet debits',
    'product credentials require atomic reserve/capture completion',
    'local order/evidence rows precede external provider calls',
    'credential reveal is completed-order only',
    'failed debit/order evidence is preserved instead of deleted',
    'reopened purchase routes bind idempotency keys to request contents before wallet debit/provider dispatch',
    'SMM and SMS orphaned-ledger checks do not reject exact existing-order replays',
    'product credentials require atomic reserve/capture completion',
    'debit-first route code does not also execute financial hold release/capture operations',
  ],
}, null, 2))
