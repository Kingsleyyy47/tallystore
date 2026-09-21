import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'

const root = process.cwd()
const inventoryPath = 'docs/security/wallet-env-secret-inventory.md'
const inventory = read(inventoryPath)
const envExample = read('.env.example')

const sourceRoots = [
  'api',
  join('pages', 'api'),
  'src',
  join('supabase', 'functions'),
  'scripts',
  '.env.example',
]

const ignoredEnvNames = new Set([
  'CI',
  'NO_COLOR',
])

const allowedBrowserVars = new Set([
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_LIVE_ACCOUNT_FULFILLMENT_ENABLED',
])

const criticalServerOnlyVars = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'ERCASPAY_SECRET_KEY',
  'ERCAS_SECRET_KEY',
  'POCKETFI_PUBLIC_KEY',
  'POCKETFI_API_TOKEN',
  'POCKETFI_WEBHOOK_SECRET',
  'POCKETFI_SECRET_KEY',
  'POCKETFI_SECRET_API_KEY',
  'NOWPAYMENTS_API_KEY',
  'NOWPAYMENTS_PASSWORD',
  'NOWPAYMENTS_IPN_SECRET',
  'ISTAR_API_KEY',
  'ISTAR_WEBHOOK_SECRET',
  'DAISYSMS_API_KEY',
  'DAISYSMS_WEBHOOK_SECRET',
  'SMM_PANEL_API_KEY',
  'BITREFILL_API_KEY',
  'SAGECLOUD_SECRET_KEY',
  'MUABANVIA_API_KEY',
  'SHOPCLONE_API_KEY',
  'SHOPVIACLONE_API_KEY',
  'SMTP_PASSWORD',
  'AUTO_RESTOCK_SECRET',
  'PAYMENT_RECOVERY_CRON_SECRET',
  'REVENUE_OS_CRON_SECRET',
  'SMM_CHECK_CRON_SECRET',
  'PARTNER_API_INTERNAL_SECRET',
  'TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION',
  'TALLYSTORE_DEPLOYED_SMOKE_CRON_SECRET',
]

const pauseFlags = [
  'BILLS_ENABLED',
  'BITREFILL_ENABLED',
  'WITHDRAWALS_ENABLED',
  'REFERRAL_WITHDRAWALS_ENABLED',
  'CRYPTO_TOPUP_ENABLED',
  'SMM_ORDERS_ENABLED',
  'SMS_OTP_ENABLED',
  'TELEGRAM_ORDERS_ENABLED',
  'LIVE_ACCOUNT_FULFILLMENT_ENABLED',
  'AUTO_RESTOCK_ENABLED',
  'MANUAL_RESTOCK_ENABLED',
]

const files = sourceRoots.flatMap((sourceRoot) => listFiles(sourceRoot))
const discovered = new Map()

for (const file of files) {
  const text = read(file)
  for (const name of extractEnvNames(text)) {
    if (ignoredEnvNames.has(name)) continue
    if (!discovered.has(name)) discovered.set(name, new Set())
    discovered.get(name).add(file)
  }
}

for (const [name, locations] of [...discovered.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  assert(inventory.includes(`\`${name}\``) || inventory.includes(`${name}=false`), `env inventory missing ${name} used in ${[...locations].join(', ')}`)
}

for (const name of criticalServerOnlyVars) {
  assert(inventory.includes(`\`${name}\``), `env inventory missing critical server-only variable ${name}`)
}

for (const name of pauseFlags) {
  assert(inventory.includes(`${name}=false`), `env inventory missing required disabled pause flag ${name}=false`)
}

for (const name of [...discovered.keys()].filter((name) => name.startsWith('VITE_'))) {
  assert(allowedBrowserVars.has(name), `browser-exposed env variable is not allowlisted: ${name}`)
}

for (const file of files.filter((file) => file === '.env.example' || file.startsWith(`src${sep}`) || file.startsWith('src/'))) {
  const text = read(file)
  for (const forbidden of criticalServerOnlyVars) {
    assert(!text.includes(`VITE_${forbidden}`), `${file} exposes server-only ${forbidden} with a VITE_ prefix`)
  }
}

assert(!/VITE_[A-Z0-9_]*(SECRET|PRIVATE|SERVICE_ROLE|TOKEN|PASSWORD|WEBHOOK)[A-Z0-9_]*/.test(envExample), '.env.example must not define browser-exposed secrets')
assert(!/ECRS-(?:TEST|LIVE)-[A-Za-z0-9]{16,}/.test(envExample), '.env.example must not contain real-looking Ercas keys')
assert(!/sk_(?:test|live)_[A-Za-z0-9]{16,}/i.test(envExample), '.env.example must not contain real-looking generic provider secret keys')
assert(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(envExample), '.env.example must not contain JWT-looking keys')

assert(!containsRuntimeSource("Deno.env.get('PARTNER_API_PAUSED')"), 'partner API pause must not be reopenable by env')
assert(!containsRuntimeSource("Deno.env.get('CRYPTO_AUTO_CREDIT_ENABLED')"), 'NOWPayments auto-credit must not be reopenable by env')

for (const phrase of [
  'Browser-exposed `VITE_` variables may contain only public configuration',
  'Do not add `VITE_ERCAS_SECRET_KEY`',
  'server-only',
  'Rotate any value that was exposed',
  'Missing verification secrets must fail closed',
]) {
  assert(inventory.includes(phrase), `env inventory missing rule phrase: ${phrase}`)
}

console.log(JSON.stringify({
  ok: true,
  envVariables: discovered.size,
  filesScanned: files.length,
  serverOnlyVariables: criticalServerOnlyVars.length,
  pauseFlags: pauseFlags.length,
}, null, 2))

function extractEnvNames(text) {
  const names = new Set()
  const patterns = [
    /Deno\.env\.get\(['"`]([A-Z0-9_]+)['"`]\)/g,
    /process\.env\.([A-Z0-9_]+)/g,
    /process\.env\[['"`]([A-Z0-9_]+)['"`]\]/g,
    /import\.meta\.env\.([A-Z0-9_]+)/g,
    /^\s*#?\s*([A-Z][A-Z0-9_]+)=/gm,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text))) names.add(match[1])
  }

  return names
}

function containsRuntimeSource(needle) {
  return files
    .filter((file) => file.startsWith('api/') || file.startsWith('pages/api/') || file.startsWith('src/') || file.startsWith('supabase/functions/'))
    .some((file) => read(file).includes(needle))
}

function listFiles(path) {
  const absolute = join(root, path)
  if (!existsSync(absolute)) return []

  const status = statSync(absolute)
  if (status.isFile()) return [toPosix(path)]

  const found = []
  walk(absolute, found)
  return found.map((file) => toPosix(relative(root, file)))
}

function walk(dir, found) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(absolute, found)
    } else if (/\.(ts|tsx|js|mjs|toml)$/.test(entry.name) || basename(absolute) === '.env.example') {
      found.push(absolute)
    }
  }
}

function toPosix(path) {
  return path.split(sep).join('/')
}

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
