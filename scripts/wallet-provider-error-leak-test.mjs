import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const ercasTopupSource = readFileSync('supabase/functions/create-wallet-topup/index.ts', 'utf8')
const redirectStart = ercasTopupSource.indexOf('function walletRedirectUrl()')
const redirectEnd = ercasTopupSource.indexOf('\nconst clientErrors =', redirectStart)
if (redirectStart < 0 || redirectEnd <= redirectStart ||
    ercasTopupSource.includes("req.headers.get('Origin')") ||
    ercasTopupSource.includes('body.redirectUrl') ||
    ercasTopupSource.includes('...body.metadata') ||
    ercasTopupSource.includes('result?.responseMessage') ||
    ercasTopupSource.includes('result?.errorMessage') ||
    !ercasTopupSource.includes("clientErrors.has(internalMessage)")) {
  throw new Error('Ercas checkout may accept a browser redirect/metadata or reveal provider errors')
}
function ercasRedirect(configuredOrigin) {
  const context = {
    URL,
    Deno: { env: { get: () => configuredOrigin } },
  }
  runInNewContext(`${ercasTopupSource.slice(redirectStart, redirectEnd)}\nglobalThis.redirect = walletRedirectUrl`, context)
  return context.redirect()
}
if (ercasRedirect(undefined) !== 'https://tallystore.org/wallet' ||
    ercasRedirect('https://staging.tallystore.org') !== 'https://staging.tallystore.org/wallet') {
  throw new Error('Ercas redirect must use the configured server site origin')
}
for (const invalidOrigin of ['http://evil.example', 'https://evil.example/path', 'https://user:pass@127.0.0.1']) {
  try {
    ercasRedirect(invalidOrigin)
    throw new Error(`Invalid Ercas redirect origin accepted: ${invalidOrigin}`)
  } catch (error) {
    if (!String(error).includes('Payment redirect configuration unavailable.')) throw error
  }
}
const staffAdminSource = readFileSync('src/pages/StaffAdminPage.tsx', 'utf8')
if (!staffAdminSource.includes("getAppSetting('ercas_enabled').then(v => setErcasEnabled(v === 'true'))")) {
  throw new Error('Staff Ercas toggle must display missing or failed enablement as off')
}

for (const route of ['bitrefill-catalog', 'get-data-plans']) {
  const source = readFileSync(`supabase/functions/${route}/index.ts`, 'utf8')
  if (/errorText|Detailed error:|console\.error\([^\n]*,\s*error\)|error:\s*errorMessage/.test(source)) {
    throw new Error(`${route} may expose a raw provider error`)
  }
  if (!source.includes('const clientMessages = new Set(') ||
      !source.includes('clientError ? message :') ||
      !source.includes('clientError ? 400 : 502')) {
    throw new Error(`${route} must separate expected client errors from provider failures`)
  }
}

const liveAccountSource = readFileSync('supabase/functions/muabanvia-fulfill/index.ts', 'utf8')
if (!liveAccountSource.includes("Deno.env.get('LIVE_ACCOUNT_FULFILLMENT_ENABLED')") ||
    !liveAccountSource.includes('if (!adminProfile?.is_admin || adminProfile.account_suspended === true)') ||
    !liveAccountSource.includes('Number.isSafeInteger(quantity)') ||
    !liveAccountSource.includes('quantity > 20') ||
    !liveAccountSource.includes("error: 'Supplier fulfillment is temporarily unavailable.'") ||
    /result\?\.(?:msg|message|error)|console\.error\('MuaBanVia fulfillment error:/.test(liveAccountSource)) {
  throw new Error('Paused live-account supplier route may leak provider errors or accept unbounded quantity')
}
const liveFlagIndex = liveAccountSource.indexOf("Deno.env.get('LIVE_ACCOUNT_FULFILLMENT_ENABLED')")
const adminGateIndex = liveAccountSource.indexOf('if (!adminProfile?.is_admin || adminProfile.account_suspended === true)')
const supplierCallIndex = liveAccountSource.indexOf('const response = await fetch(baseUrl')
if (liveFlagIndex < 0 || adminGateIndex < liveFlagIndex || supplierCallIndex < adminGateIndex) {
  throw new Error('Live-account supplier request must follow both pause and admin gates')
}

for (const [route, safeMessage] of [
  ['get-available-cryptos', 'Cryptocurrency list is temporarily unavailable.'],
  ['update-crypto-rates', 'Crypto estimate is temporarily unavailable.'],
]) {
  const source = readFileSync(`supabase/functions/${route}/index.ts`, 'utf8')
  const finalCatch = source.slice(source.lastIndexOf('} catch ('))
  if (!finalCatch.includes(safeMessage) ||
      /error:\s*(?:error|err)\.message|console\.error\(/.test(finalCatch) ||
      !source.includes("/^[a-z0-9]{2,20}$/i.test(")) {
    throw new Error(`${route} may expose provider errors or accept unchecked currency input`)
  }
  if (route === 'update-crypto-rates' && !source.includes('new URLSearchParams({')) {
    throw new Error('Crypto estimate must encode provider query parameters')
  }
}

const emailSource = readFileSync('supabase/functions/email/index.ts', 'utf8')
const referralSource = readFileSync('supabase/functions/apply-referral/index.ts', 'utf8')
const smsSource = readFileSync('supabase/functions/smsbus/index.ts', 'utf8')
const staffSource = readFileSync('supabase/functions/manage-staff/index.ts', 'utf8')
if (!smsSource.includes("error_message: safeToRefund ? friendlyError(err) : 'Provider outcome requires review.'") ||
    !smsSource.includes('error: friendlyError(err)') ||
    !smsSource.includes("if (!safeToRefund) {\n      return json({ success: false, code: 'SMS_OUTCOME_REVIEW_REQUIRED'") ||
    /error_message: err instanceof Error \? err\.message/.test(smsSource)) {
  throw new Error('SMS purchase failures must not persist raw provider or database errors')
}
const revenueLoopSource = readFileSync('supabase/functions/revenue-os-loop/index.ts', 'utf8')
if (/return json\(\{ success: false, error: (?:error\.message|result\.error|String\(err\)|message) \}/.test(emailSource) ||
    /return json\(\{ error: (?:error|permissionError|claimError|reviewError)\.message \}/.test(staffSource) ||
    /return json\(\{ error: msg \}, status\)/.test(staffSource) ||
    /JSON\.stringify\(\{ ok: false, error: err\?\.message \}\)/.test(revenueLoopSource) ||
    !staffSource.includes("err instanceof HttpError ? msg : 'Staff request failed'") ||
    !revenueLoopSource.includes("error: 'Revenue loop failed'")) {
  throw new Error('Email, staff, or scheduled revenue routes may disclose raw internal failures')
}
if (referralSource.includes('error: updateError.message') ||
    referralSource.includes('error: message') ||
    !referralSource.includes("error: 'Referral is temporarily unavailable.'") ||
    referralSource.indexOf('auth.getUser(') > referralSource.indexOf("supabaseAdmin.rpc('apply_profile_referral_attribution'")) {
  throw new Error('Referral attribution may disclose database failures or run before authentication')
}
const adminSource = readFileSync('src/pages/AdminPage.tsx', 'utf8')
const broadcastSource = emailSource.slice(
  emailSource.indexOf('async function handleBroadcast(req: Request)'),
  emailSource.indexOf('// ─── Route: POST /email/process-broadcast'),
)
if (emailSource.includes('sampleRecipients') || adminSource.includes('dryRunResult.sampleRecipients') ||
    !broadcastSource.includes('await requireAdminOrStaffPermission(') ||
    !broadcastSource.includes('totalRecipients: consented.totalRecipients') ||
    broadcastSource.indexOf('await requireAdminOrStaffPermission(') >
      broadcastSource.indexOf('listPromotionConsentedEmails(admin)')) {
  throw new Error('Email broadcast preview must reveal only an authorized recipient count')
}

const paymentRecoverySource = readFileSync('supabase/functions/check-pending-payments/index.ts', 'utf8')
const paymentVerificationSource = readFileSync('supabase/functions/verify-and-credit-wallet/index.ts', 'utf8')
if (/error_message:\s*(?:message|verifyResponse\.error\.message|verifyData\.message)/.test(paymentRecoverySource) ||
    /JSON\.stringify\(verifyData\)|console\.log\([^\n]*verifyData\)/.test(paymentRecoverySource) ||
    /error_message:\s*message|error:\s*errorMsg|error:\s*errorMessage/.test(paymentVerificationSource) ||
    /const message = error instanceof Error \? error\.message/.test(paymentVerificationSource)) {
  throw new Error('Payment verification must not store or return raw provider errors')
}

const pocketFiSource = readFileSync('supabase/functions/create-pocketfi-topup/index.ts', 'utf8')
const pocketFiWebhookSource = readFileSync('supabase/functions/webhook-pocketfi/index.ts', 'utf8')
const cryptoSellSource = readFileSync('supabase/functions/create-crypto-sell-order/index.ts', 'utf8')
const chatbotSource = readFileSync('supabase/functions/chatbot/index.ts', 'utf8')
const nowPaymentsWebhookSource = readFileSync('supabase/functions/nowpayments-webhook/index.ts', 'utf8')
const visitSource = readFileSync('supabase/functions/record-site-visit/index.ts', 'utf8')
const getIpSource = readFileSync('supabase/functions/get-my-ip/index.ts', 'utf8')
const istarWebhookSource = readFileSync('api/webhook-istar.ts', 'utf8')
const telegramSource = readFileSync('supabase/functions/telegram-stars/index.ts', 'utf8')
if (/const errorText = await response\.text\(\)|error:\s*errorMessage|error:\s*error\.message/.test(nowPaymentsWebhookSource) ||
    !nowPaymentsWebhookSource.includes("error: 'Webhook processing failed'") ||
    !nowPaymentsWebhookSource.includes('status check failed with HTTP ${response.status}')) {
  throw new Error('NOWPayments webhook may expose a provider or internal failure')
}
if (/error:\s*error instanceof Error \? error\.message|console\.error\('record-site-visit failed:', error\)/.test(visitSource) ||
    !visitSource.includes("error: 'Visit recording unavailable'")) {
  throw new Error('Public visit telemetry may expose internal database failures')
}
if (!getIpSource.includes(".select('is_admin, account_suspended').eq('id', user.id).single()") ||
    getIpSource.indexOf("profile?.is_admin !== true") > getIpSource.indexOf('await fetch(service)') ||
    getIpSource.indexOf('profile.account_suspended === true') > getIpSource.indexOf('await fetch(service)') ||
    /error:\s*error\.message/.test(getIpSource) ||
    !getIpSource.includes("error: 'IP detection unavailable'")) {
  throw new Error('IP utility must authorize current admins before external lookups and hide failures')
}
if (/Failed to load profile: \$\{|console\.error\('Create PocketFi account error:', message\)/.test(pocketFiSource) ||
    !pocketFiSource.includes('Contact support before creating another account.') ||
    /error_message: err\.message|json\(\{ error: err\.message \}\)|error_message: reason/.test(istarWebhookSource) ||
    !istarWebhookSource.includes("if (completionError) throw new Error('Could not record completed order')") ||
    /throw new Error\(data\?\.message|error_message: err\.message|error: err\.message|Order failed: \$\{err\.message\}/.test(telegramSource)) {
  throw new Error('Wallet providers or supplier webhooks may expose raw failures')
}
if (!pocketFiWebhookSource.includes("return json({ error: 'PocketFi processing unavailable' }, 500)") ||
    /data:\s*partnerResult|data:\s*\{\s*user_id|return json\(\{ error: message|message:\s*error instanceof Error \? error\.message/.test(pocketFiWebhookSource)) {
  throw new Error('PocketFi webhook may expose partner responses, wallet identity, balance, or internal errors')
}
const pocketFiLogInsert = pocketFiWebhookSource.indexOf('const { data: logRow, error: logError }')
const pocketFiLogGuard = pocketFiWebhookSource.indexOf('if (logError || !logRow?.id)')
const pocketFiMatchGuard = pocketFiWebhookSource.indexOf('if (matchError || !matchedLog?.id)')
const pocketFiWalletCredit = pocketFiWebhookSource.indexOf('const creditResult = await applyWalletTransaction')
if (pocketFiLogInsert < 0 || pocketFiLogGuard <= pocketFiLogInsert ||
    pocketFiMatchGuard <= pocketFiLogGuard || pocketFiWalletCredit <= pocketFiMatchGuard ||
    !pocketFiWebhookSource.includes('webhook_log_id: matchedLog.id')) {
  throw new Error('PocketFi wallet credit must fail closed when webhook evidence cannot be recorded or linked')
}
if (/debug_info|auth_header_prefix|error_details:\s*(?:parseError|forexError|nowpaymentsError|error)\??\.message|error_details:\s*error\??\.toString\(|error:\s*error\??\.message/.test(cryptoSellSource) ||
    !cryptoSellSource.includes("error: clientError ? message : 'Crypto order is temporarily unavailable.'") ||
    !cryptoSellSource.includes("error: 'Provider payment creation failed'")) {
  throw new Error('Crypto top-up route may disclose auth debug fields or provider/database failures')
}
if (/error:\s*error\??\.message/.test(chatbotSource) ||
    !chatbotSource.includes('error: "Chat is temporarily unavailable."')) {
  throw new Error('Public chatbot may disclose internal failures')
}

const { default: pocketFiBridge } = await import('../api/webhook-pocketfi.ts')
const originalFetch = globalThis.fetch
async function invokePocketFiBridge(fetchResult) {
  let status = 200
  let body
  const response = {
    status(code) { status = code; return this },
    setHeader() { return this },
    json(value) { body = value; return this },
    send(value) { body = value; return this },
  }
  globalThis.fetch = async () => fetchResult()
  try {
    await pocketFiBridge({
      method: 'POST',
      url: '/api/webhook-pocketfi',
      headers: { 'x-pocketfi-signature': 'invalid-test-signature' },
      body: '{}',
    }, response)
    return { status, body }
  } finally {
    globalThis.fetch = originalFetch
  }
}

const upstreamFailure = await invokePocketFiBridge(() => new Response(
  '{"error":"internal_sql_secret_test_value"}',
  { status: 500, headers: { 'content-type': 'application/json' } },
))
if (upstreamFailure.status !== 500 ||
    JSON.stringify(upstreamFailure.body).includes('internal_sql_secret_test_value')) {
  throw new Error('PocketFi bridge exposed a raw upstream failure')
}

const networkFailure = await invokePocketFiBridge(() => {
  throw new Error('internal_network_secret_test_value')
})
if (networkFailure.status !== 502 ||
    JSON.stringify(networkFailure.body).includes('internal_network_secret_test_value')) {
  throw new Error('PocketFi bridge exposed a raw network failure')
}

const success = await invokePocketFiBridge(() => new Response('{"received":true}', {
  status: 200,
  headers: { 'content-type': 'application/json' },
}))
if (success.status !== 200 || success.body !== '{"received":true}') {
  throw new Error('PocketFi bridge changed successful acknowledgements')
}

console.log('Provider failures, payment verification, and email previews avoid raw provider or customer data.')
