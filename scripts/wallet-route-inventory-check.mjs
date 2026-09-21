import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = process.cwd()
const inventoryPath = 'docs/security/wallet-route-inventory.md'
const inventory = read(inventoryPath)
const normalizedInventory = inventory.replace(/\s+/g, ' ')
const deployedSmoke = read('scripts/wallet-deployed-smoke-test.mjs')

const requiredLabels = [
  'VALUE_DELIVERY',
  'FUNDING_OR_WEBHOOK',
  'ADMIN_OR_INTERNAL',
  'READ_ONLY_OR_CATALOG',
  'TELEMETRY_OR_UTILITY',
  'PAUSED_OR_MANUAL_REVIEW',
  'OWNER_PRODUCTION_CHECK_REQUIRED',
]

const apiRoutes = [
  ...listFiles('api', (file) => file.endsWith('.ts')),
  ...listFiles(join('pages', 'api'), (file) => file.endsWith('.ts')),
].map(toPosix)

const criticalApiRoutes = [
  'api/partner-api.ts',
  'api/webhook-ercas.ts',
  'api/webhook-istar.ts',
  'api/webhook-pocketfi.ts',
  'pages/api/webhook/ercas.ts',
]

const functions = readdirSync(join(root, 'supabase', 'functions'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .filter((entry) => existsSync(join(root, 'supabase', 'functions', entry.name, 'index.ts')))
  .map((entry) => entry.name)
  .sort()

const jwtDisabledFunctions = functions
  .filter((name) => {
    const configPath = join('supabase', 'functions', name, 'config.toml')
    return existsSync(join(root, configPath)) && read(configPath).includes('verify_jwt = false')
  })
  .sort()

const frontendSurfaces = [
  'src/pages/CheckoutPage.tsx',
  'src/pages/ProductDetailPage.tsx',
  'src/pages/SocialBoostPage.tsx',
  'src/pages/SmsNumbersPage.tsx',
  'src/pages/TelegramStarsPage.tsx',
  'src/pages/BillsPayment.tsx',
  'src/pages/GiftCardsEsims.tsx',
  'src/pages/CryptoExchange.tsx',
  'src/pages/CryptoWithdrawal.tsx',
  'src/pages/ReferralWithdrawal.tsx',
  'src/pages/ReferralsPage.tsx',
  'src/pages/OrderHistoryPage.tsx',
  'src/pages/AdminPage.tsx',
  'src/pages/StaffAdminPage.tsx',
  'src/pages/WalletPage.tsx',
  'src/pages/PaymentCallbackPage.tsx',
  'src/pages/PaymentSuccessPage.tsx',
]

const valueFunctions = [
  'auto-restock',
  'create-crypto-sell-order',
  'create-withdrawal-request',
  'manual-restock',
  'muabanvia-fulfill',
  'partner-api',
  'process-purchase',
  'purchase-bills',
  'purchase-bitrefill',
  'smm-create-order',
  'smsbus',
  'telegram-stars',
  'withdraw-referral-balance',
]

const fundingFunctions = [
  'check-pending-payments',
  'create-pocketfi-topup',
  'create-wallet-topup',
  'nowpayments-webhook',
  'smm-check-all-orders',
  'smm-check-status',
  'smsbus',
  'verify-and-credit-wallet',
  'webhook-pocketfi',
]

const pausedOrManualReviewFunctions = [
  'auto-restock',
  'create-crypto-sell-order',
  'create-withdrawal-request',
  'manual-restock',
  'muabanvia-fulfill',
  'nowpayments-webhook',
  'partner-api',
  'purchase-bills',
  'purchase-bitrefill',
  'smm-create-order',
  'smsbus',
  'telegram-stars',
  'withdraw-referral-balance',
]

const pausedValueFunctions = pausedOrManualReviewFunctions
  .filter((fn) => valueFunctions.includes(fn))

for (const label of requiredLabels) {
  assert(inventory.includes(label), `inventory missing classification label ${label}`)
}

for (const route of apiRoutes) {
  assert(inventory.includes(`\`${route}\``), `inventory missing Vercel API route ${route}`)
}

for (const route of criticalApiRoutes) {
  assert(apiRoutes.includes(route), `critical API route missing from repository: ${route}`)
  assert(inventory.includes(`\`${route}\``), `inventory missing critical API route ${route}`)
}

for (const fn of functions) {
  assert(inventory.includes(`\`${fn}\``), `inventory missing Supabase function ${fn}`)
}

for (const fn of jwtDisabledFunctions) {
  assert(inventory.includes(`\n${fn}`) || inventory.includes(`\`${fn}\``), `inventory missing JWT-disabled function ${fn}`)
}

for (const phrase of [
  'Supabase Edge Functions default to JWT verification',
  'The only JWT-disabled functions in this repository are',
  'Each JWT-disabled function must perform its own internal authorization',
  'Every other Edge Function currently relies on the Supabase default JWT gate',
]) {
  assert(normalizedInventory.includes(phrase), `inventory missing Edge auth boundary phrase: ${phrase}`)
}

for (const surface of frontendSurfaces) {
  assert(inventory.includes(`\`${surface}\``), `inventory missing frontend value surface ${surface}`)
}

for (const surface of [
  'src/pages/SocialBoostPage.tsx',
  'src/pages/SmsNumbersPage.tsx',
  'src/pages/TelegramStarsPage.tsx',
]) {
  assert(rowFor(surface).includes('PAUSED_OR_MANUAL_REVIEW'), `${surface} must be classified as paused/manual review while its backend order route is paused`)
}

for (const fn of valueFunctions) {
  assert(rowFor(fn).includes('VALUE_DELIVERY'), `${fn} must be classified as VALUE_DELIVERY`)
}

for (const fn of fundingFunctions) {
  assert(rowFor(fn).includes('FUNDING_OR_WEBHOOK'), `${fn} must be classified as FUNDING_OR_WEBHOOK`)
}

for (const fn of pausedOrManualReviewFunctions) {
  assert(rowFor(fn).includes('PAUSED_OR_MANUAL_REVIEW'), `${fn} must be classified as paused/manual review`)
}

for (const fn of pausedValueFunctions) {
  assert(deployedSmoke.includes(`'${fn}'`) || deployedSmoke.includes(`"${fn}"`), `${fn} must have a deployed smoke denied/paused probe`)
}

for (const phrase of [
  'Any new `api/**/*.ts`, `pages/api/**/*.ts`, `supabase/functions/*/index.ts`',
  'mutation and fulfillment maps',
  'must be added here',
]) {
  assert(inventory.includes(phrase), `inventory missing review rule phrase: ${phrase}`)
}

console.log(JSON.stringify({
  ok: true,
  apiRoutes: apiRoutes.length,
  supabaseFunctions: functions.length,
  jwtDisabledFunctions: jwtDisabledFunctions.length,
  frontendSurfaces: frontendSurfaces.length,
  valueFunctions: valueFunctions.length,
  fundingFunctions: fundingFunctions.length,
  pausedValueSmokeProbes: pausedValueFunctions.length,
}, null, 2))

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function listFiles(base, predicate) {
  const absoluteBase = join(root, base)
  if (!existsSync(absoluteBase)) return []

  const found = []
  walk(absoluteBase, found, predicate)
  return found.map((file) => relative(root, file))
}

function walk(dir, found, predicate) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(absolute, found, predicate)
    } else if (predicate(absolute)) {
      found.push(absolute)
    }
  }
}

function toPosix(path) {
  return path.split(sep).join('/')
}

function rowFor(name) {
  const pattern = new RegExp('^\\| `' + escapeRegExp(name) + '` \\|.*$', 'm')
  return inventory.match(pattern)?.[0] || ''
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
