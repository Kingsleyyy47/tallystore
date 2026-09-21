import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function walk(dir, files = []) {
  const abs = join(root, dir)
  if (!existsSync(abs)) return files
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry)
    const rel = relative(root, full).replaceAll('\\', '/')
    if (statSync(full).isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(entry)) walk(rel, files)
    } else {
      files.push(rel)
    }
  }
  return files
}

const checks = []

function check(name, fn) {
  checks.push({ name, fn })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertThrows(fn, message) {
  try {
    fn()
  } catch {
    return
  }
  throw new Error(message)
}

function parseExactPositiveMoneyForTest(value) {
  const text = String(value).trim()
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(text)) {
    throw new Error('invalid_money_format')
  }

  const [whole, fraction = ''] = text.split('.')
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (minor <= 0n) throw new Error('money_must_be_positive')
  if (minor > 100000000000n) throw new Error('money_too_large')
  return minor
}

function normalizeCurrencyForTest(value) {
  const text = String(value || 'NGN').trim().toUpperCase()
  if (!/^[A-Z]{3,8}$/.test(text)) throw new Error('invalid_currency')
  return text
}

function assertOrder(src, earlier, later, message) {
  const earlierIndex = src.indexOf(earlier)
  const laterIndex = src.indexOf(later)
  assert(earlierIndex !== -1, `${message}: missing ${earlier}`)
  assert(laterIndex !== -1, `${message}: missing ${later}`)
  assert(earlierIndex < laterIndex, message)
}

function contains(path, needle) {
  return read(path).includes(needle)
}

function migrationFilesContaining(needle) {
  return readdirSync(join(root, 'supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => read(`supabase/migrations/${name}`).includes(needle))
}

function includesPhrase(doc, phrase) {
  return String(doc).replace(/\s+/g, ' ').includes(String(phrase).replace(/\s+/g, ' '))
}

function statementSegment(src, index) {
  const lineStart = src.lastIndexOf('\n', index) + 1
  const lineEnd = src.indexOf('\n', index)
  const lines = [src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd)]
  let cursor = lineEnd === -1 ? src.length : lineEnd + 1

  while (cursor < src.length) {
    const nextLineEnd = src.indexOf('\n', cursor)
    const line = src.slice(cursor, nextLineEnd === -1 ? src.length : nextLineEnd)
    const trimmed = line.trim()
    if (!trimmed.startsWith('.')) break
    lines.push(line)
    cursor = nextLineEnd === -1 ? src.length : nextLineEnd + 1
  }

  return lines.join('\n')
}

function doesNotContain(path, needle) {
  return !read(path).includes(needle)
}

check('public partner API bridge is paused', () => {
  const src = read('api/partner-api.ts')
  assert(src.includes("code: 'PARTNER_API_PAUSED'"), 'missing pause code')
  assert(src.includes('return res.status(503).json'), 'bridge must return 503 before proxying')
  assert(!src.includes('functions/v1/partner-api'), 'public bridge must not keep an upstream partner-api proxy URL')
  assert(!src.includes('fetch('), 'public bridge must not proxy requests while paused')
})

check('Supabase partner API is hard-paused, not env-toggle reopened', () => {
  const src = read('supabase/functions/partner-api/index.ts')
  assert(src.includes('const PARTNER_API_PAUSED = true'), 'partner-api pause must be hard-coded true')
  assert(!src.includes("Deno.env.get('PARTNER_API_PAUSED')"), 'partner-api must not depend on PARTNER_API_PAUSED env')
  assert(src.includes("code: 'PARTNER_API_PAUSED'"), 'partner-api must return pause code')
})

check('partner admin mutations are read-only during incident pause', () => {
  const src = read('supabase/functions/partner-api/index.ts')
  assert(src.includes('const PARTNER_ADMIN_MUTATIONS_PAUSED = true'), 'partner admin mutation pause must be hard-coded true')
  assert(src.includes('PARTNER_ADMIN_MUTATION_ACTIONS'), 'partner admin mutation action allowlist must exist')
  for (const action of [
    'admin_create_partner',
    'admin_update_partner',
    'admin_generate_key',
    'admin_revoke_key',
    'admin_adjust_balance',
  ]) {
    assert(src.includes(`'${action}'`), `partner admin mutation pause must cover ${action}`)
  }
  assert(src.includes("code: 'PARTNER_API_ADMIN_PAUSED'"), 'partner admin mutations must return pause code')

  const adminPage = read('src/pages/AdminPage.tsx')
  assert(adminPage.includes('const PARTNER_API_INCIDENT_PAUSED = true'), 'admin UI must hard-code partner incident pause')
  assert(adminPage.includes('Catalogue, checkout, order creation, key generation, partner edits, and partner balance changes are locked'), 'admin UI must show partner pause scope')
  assert(adminPage.includes('disabled={PARTNER_API_INCIDENT_PAUSED || apiPartnerSaving === `key-${partner.id}`}'), 'admin UI must disable key generation while paused')
  assert(adminPage.includes('disabled={PARTNER_API_INCIDENT_PAUSED || apiPartnerSaving === `revoke-${key.id}`}'), 'admin UI must disable key revocation while paused')
  assert(adminPage.includes('disabled={PARTNER_API_INCIDENT_PAUSED || apiPartnerSaving === partner.id}'), 'admin UI must disable partner save/update while paused')
})

check('existing API partners are data-paused during incident review', () => {
  const src = read('supabase/migrations/20260919007000_pause_existing_api_partners.sql')
  assert(src.includes('UPDATE public.api_partners'), 'missing api partner pause update')
  assert(src.includes('SET is_active = false'), 'existing partners must be marked inactive')
  assert(src.includes('reactivation_requires_owner_review'), 'partner reactivation must require owner review evidence')
})

check('partner tables are not directly readable or writable by browser roles', () => {
  const src = read('supabase/migrations/20260919008000_harden_partner_table_authority.sql')
  const cascadeGuard = read('supabase/migrations/20260919021000_restrict_partner_cascade_evidence.sql')
  for (const table of [
    'api_partners',
    'api_partner_keys',
    'api_partner_orders',
    'api_partner_logs',
    'api_partner_customers',
    'api_partner_webhook_deliveries',
  ]) {
    assert(src.includes(`public.${table}`), `missing partner grant hardening for ${table}`)
  }
  assert(src.includes('REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE'), 'partner table migration must revoke browser reads and writes')
  assert(!src.includes('GRANT SELECT ON public.api_partners TO authenticated'), 'partner pause must not grant direct browser reads')
  assert(cascadeGuard.includes('Partner/API incident evidence must survive partner-record deletion attempts'), 'partner cascade guard must document evidence preservation')
  assert(cascadeGuard.includes('api_partner_webhook_deliveries'), 'partner cascade guard must cover webhook-delivery evidence')
  assert(cascadeGuard.includes("con.confdeltype = 'c'"), 'partner cascade guard must target cascading foreign keys')
  assert(cascadeGuard.includes('ON DELETE RESTRICT'), 'partner cascade guard must replace cascades with restrictive keys')
})

check('legacy balance RPCs are retired from browser roles', () => {
  const src = read('supabase/migrations/20260919009000_retire_legacy_balance_rpcs.sql')
  for (const fn of [
    'update_wallet_balance(uuid,numeric,text,text,text)',
    'credit_crypto_balance(uuid,numeric)',
    'deduct_crypto_balance(uuid,numeric)',
    'transfer_crypto_to_wallet(uuid,numeric)',
    'withdraw_referral_balance_to_wallet(uuid)',
  ]) {
    assert(src.includes(fn), `missing legacy RPC revoke for ${fn}`)
  }
  assert(src.includes('REVOKE ALL ON FUNCTION'), 'legacy RPC migration must revoke function execution')
})

check('pending payment evidence is server-owned and fail-closed', () => {
  const migration = read('supabase/migrations/20260919010000_harden_pending_payment_evidence.sql')
  assert(migration.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pending_payments FROM anon, authenticated'), 'pending_payments must not be browser-writable')
  assert(migration.includes('pending_payments_amount_positive'), 'pending_payments must require positive amount')
  assert(migration.includes('pending_payments_transaction_reference_not_blank'), 'pending_payments must require nonblank transaction reference')

  const topup = read('supabase/functions/create-wallet-topup/index.ts')
  assert(topup.includes('pendingPaymentError'), 'create-wallet-topup must check pending_payments insert errors')
  assert(topup.includes('pending_payment_evidence_create'), 'create-wallet-topup must record pending evidence creation failures')
  assert(topup.includes('Could not create trusted payment evidence'), 'create-wallet-topup must fail closed before returning checkout URL')
})

check('PocketFi partner payments are manual-review while partner API is paused', () => {
  const src = read('supabase/functions/webhook-pocketfi/index.ts')
  assert(src.includes("partnerResult?.code === 'PARTNER_API_PAUSED'"), 'PocketFi must handle paused partner API explicitly')
  assert(src.includes('manual review required'), 'paused partner payments must be logged for manual review')
})

check('PocketFi duplicate references cannot silently credit mismatched payments', () => {
  const src = read('supabase/functions/webhook-pocketfi/index.ts')
  assert(src.includes('POCKETFI_REFERENCE_CONFLICT'), 'PocketFi duplicate reference conflicts must return a conflict code')
  assert(src.includes('existingTransaction.user_id !== userId'), 'PocketFi duplicate check must compare credited user')
  assert(src.includes('Math.round(existingAmount * 100) !== Math.round(amount * 100)'), 'PocketFi duplicate check must compare credited amount')
})

check('PocketFi Vercel bridge preserves provider verification boundaries', () => {
  const src = read('api/webhook-pocketfi.ts')

  assert(src.includes('bodyParser: false'), 'PocketFi bridge must disable body parsing before proxying signatures')
  assert(src.includes('readRawBody'), 'PocketFi bridge must forward the raw webhook body')
  assert(src.includes('functions/v1/webhook-pocketfi'), 'PocketFi bridge must proxy only to the hardened Edge Function')
  assert(src.includes('hasVerificationHeader'), 'PocketFi bridge must require a provider verification header')
  assert(src.includes('Missing PocketFi webhook verification header'), 'PocketFi bridge must fail closed without a verification header')
  assert(src.includes('pocketfi-signature'), 'PocketFi bridge must forward PocketFi signature headers')
  assert(src.includes('x-pocketfi-signature'), 'PocketFi bridge must forward alternate PocketFi signature headers')
  assert(src.includes('x-webhook-signature'), 'PocketFi bridge must forward webhook signature headers')
  assert(src.includes('x-pocketfi-webhook-secret'), 'PocketFi bridge must forward provider webhook-secret headers when supplied by PocketFi')

  for (const forbidden of [
    'POCKETFI_WEBHOOK_SECRET',
    'POCKETFI_SECRET_KEY',
    'POCKETFI_SECRET_API_KEY',
    'VITE_POCKETFI_SECRET_KEY',
  ]) {
    assert(!src.includes(forbidden), `PocketFi bridge must not inject ${forbidden}`)
  }
})

check('legacy Ercas Vercel webhooks are closed', () => {
  for (const path of ['api/webhook-ercas.ts', 'pages/api/webhook/ercas.ts']) {
    const src = read(path)
    assert(src.includes('410'), `${path} must return gone`)
    assert(src.includes('deprecated') || src.includes('disabled'), `${path} must explain the closure`)
  }
})

check('crypto transfer RPC is disabled and hidden from UI', () => {
  const migration = read('supabase/migrations/20260919000000_pause_unsafe_financial_surfaces.sql')
  assert(migration.includes('CREATE OR REPLACE FUNCTION public.transfer_crypto_to_wallet'), 'missing disabled transfer RPC')
  assert(migration.includes('temporarily disabled during wallet security review'), 'transfer RPC must raise review-disabled error')
  assert(migration.includes('REVOKE ALL ON FUNCTION public.transfer_crypto_to_wallet(uuid, numeric) FROM public, anon, authenticated'), 'transfer RPC must be revoked')
  assert(doesNotContain('src/components/CryptoBalanceCard.tsx', 'transfer_crypto_to_wallet'), 'crypto balance card must not call transfer RPC')
  assert(doesNotContain('src/components/CryptoBalanceCard.tsx', 'Transfer to TallyStore Balance'), 'old crypto transfer modal must not be visible')
})

check('NOWPayments crypto webhooks are hard-held for review, not env auto-credited', () => {
  const src = read('supabase/functions/nowpayments-webhook/index.ts')
  assert(src.includes('return false;'), 'crypto auto-credit switch must be hard disabled')
  assert(!src.includes("Deno.env.get('CRYPTO_AUTO_CREDIT_ENABLED')"), 'crypto auto-credit must not be reopenable by env')
  assert(src.includes('completed_pending_review'), 'verified crypto payments must be held for manual review')
  assert(src.includes('crypto_auto_credit_disabled_manual_review_required'), 'manual review hold reason must be explicit')
  assert(src.includes('NOWPAYMENTS_IPN_SECRET'), 'NOWPayments webhook must require IPN signature secret')
  assert(src.includes('verifyIPNSignature'), 'NOWPayments webhook must verify IPN signatures')
  assert(src.includes('fetchNowPaymentsStatus'), 'NOWPayments webhook must verify finished payments server-to-server')
})

check('wallet engine is service-role only and detects idempotency conflicts', () => {
  const src = read('supabase/migrations/20260919001000_enforce_backed_wallet_purchases.sql')
  const replayEngine = read('supabase/migrations/202609170060_create_wallet_transaction_engine.sql')
  assert(src.includes('GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction'), 'missing wallet engine grant')
  assert(src.includes('TO service_role'), 'wallet engine must only be granted to service_role')
  assert(src.includes('FROM public, anon, authenticated'), 'wallet engine must revoke public/browser roles')
  assert(src.includes('IDEMPOTENCY_CONFLICT'), 'wallet engine must detect conflicting idempotency reuse')
  assert(src.includes('WHEN OTHERS THEN'), 'wallet engine must clean privileged transaction-local flags on non-idempotency exceptions')
  assert(src.includes("set_config('app.tally_request_forensics', '{}', true)"), 'wallet engine must clear request forensics after freeze/event paths and exceptions')
  assert(replayEngine.includes('WHEN OTHERS THEN'), 'replay wallet engine must clean transaction-local flags on non-idempotency exceptions')
  assert(replayEngine.includes("set_config('app.tally_wallet_engine_authorized', 'false', true)"), 'replay wallet engine must clear wallet-engine authorization before idempotency returns and exceptions')
  assertOrder(
    src,
    'WHEN OTHERS THEN',
    'RAISE;\nEND;',
    'wallet engine catch-all cleanup must re-raise after clearing privileged flags',
  )
})

check('future public functions are not browser-executable by default', () => {
  const src = read('supabase/migrations/20260919011000_harden_default_function_privileges.sql')
  assert(src.includes('ALTER DEFAULT PRIVILEGES IN SCHEMA public'), 'default function privileges must be hardened in public schema')
  assert(src.includes('REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC'), 'future functions must not inherit PUBLIC execute')
  assert(src.includes('REVOKE EXECUTE ON FUNCTIONS FROM anon'), 'future functions must not inherit anon execute')
  assert(src.includes('REVOKE EXECUTE ON FUNCTIONS FROM authenticated'), 'future functions must not inherit authenticated execute')
  assert(src.includes('Intended public RPCs must receive explicit grants'), 'migration must document explicit grants for intended public RPCs')
})

check('wallet purchases require backed available funds and freeze on mismatch', () => {
  const src = read('supabase/migrations/20260919001000_enforce_backed_wallet_purchases.sql')
  const trigger = read('supabase/migrations/20260919015000_enforce_trusted_principal_transaction_guard.sql')
  const fraudEvidence = read('supabase/migrations/20260919004000_harden_fraud_credit_evidence.sql')
  const ledgerEvaluatorDefinitions = migrationFilesContaining('CREATE OR REPLACE FUNCTION public.evaluate_customer_ledger_suspension')
  assert(
    ledgerEvaluatorDefinitions.at(-1) === '20260919004000_harden_fraud_credit_evidence.sql',
    `hardened fraud evaluator must be the final migration definition, got ${ledgerEvaluatorDefinitions.at(-1) || 'none'}`,
  )
  assert(!fraudEvidence.includes("'staff_credit'"), 'final fraud evaluator must not count staff_credit as trusted principal')
  assert(!fraudEvidence.includes("'referral_withdrawal'"), 'final fraud evaluator must not count referral withdrawals as trusted principal')
  assert(!fraudEvidence.includes('trusted_credits := trusted_credits + crypto_credits'), 'final fraud evaluator must not add crypto review credits to trusted principal')
  assert(!fraudEvidence.includes('net_spend := GREATEST(completed_spend - completed_refunds, 0)'), 'final fraud evaluator must not subtract all refunds as trusted restoration')
  assert(src.includes('v_authoritative_available'), 'missing authoritative available calculation')
  assert(src.includes('v_trusted_debit_capacity := LEAST(v_previous_wallet_debits, v_trusted_credits)'), 'wallet engine must cap debit restoration by trusted principal')
  assert(src.includes('WITH eligible_refund_matches AS'), 'wallet engine must calculate refund restoration from linked eligible refunds')
  assert(src.includes("COALESCE(d.metadata->>'trusted_principal_authorized', '') = 'true'"), 'wallet engine must count only refunds linked to trusted-principal-authorized debits')
  assert(src.includes("d.metadata->>'trusted_principal_debit_amount'"), 'wallet engine must require trusted-principal debit amount evidence for refund restoration')
  assert(src.includes('SELECT COALESCE(SUM(LEAST(refund_amount, debit_amount)), 0)'), 'wallet engine must cap linked refunds by each original debit amount')
  assert(trigger.includes('WITH eligible_refund_matches AS'), 'trusted-principal trigger must calculate refund restoration from linked eligible refunds')
  assert(trigger.includes("COALESCE(d.metadata->>'trusted_principal_authorized', '') = 'true'"), 'trusted-principal trigger must count only refunds linked to trusted-principal-authorized debits')
  assert(trigger.includes("d.metadata->>'trusted_principal_debit_amount'"), 'trusted-principal trigger must require trusted-principal debit amount evidence for refund restoration')
  assert(fraudEvidence.includes('WITH eligible_refund_matches AS'), 'fraud ledger scanner must calculate refund restoration from linked eligible refunds')
  assert(fraudEvidence.includes("COALESCE(d.metadata->>'trusted_principal_authorized', '') = 'true'"), 'fraud ledger scanner must count only refunds linked to trusted-principal-authorized debits')
  assert(fraudEvidence.includes("d.metadata->>'trusted_principal_debit_amount'"), 'fraud ledger scanner must require trusted-principal debit amount evidence for refund restoration')
  assert(src.includes('v_trusted_consumed_spend := GREATEST(v_trusted_debit_capacity - v_eligible_refunds, 0)'), 'wallet engine must calculate consumed trusted spend')
  assert(src.includes('v_authoritative_available := GREATEST(v_trusted_credits - v_trusted_consumed_spend, 0)'), 'wallet engine must not add refunds as new trusted money')
  assert(!src.includes('v_authoritative_available := v_trusted_credits + v_eligible_refunds - v_previous_wallet_debits'), 'wallet engine must not use refunds as additive principal')
  assert(src.includes("lower(COALESCE(t.status, 'completed')) = 'completed'"), 'wallet engine must normalize transaction status case when checking completed rows')
  assert(src.includes("lower(COALESCE(status, 'completed')) = 'completed'"), 'wallet engine must normalize aggregate status case when checking completed rows')
  assert(!src.includes("COALESCE(t.status, 'completed') = 'completed'"), 'wallet engine must not use case-sensitive completed status checks')
  assert(!src.includes("COALESCE(status, 'completed') = 'completed'"), 'wallet engine aggregate checks must not be case-sensitive')
  assert(!src.includes("'deposit',\n          'credit'"), 'wallet engine must not count generic credit rows as trusted principal')
  assert(!trigger.includes("'deposit',\n        'credit'"), 'trusted-principal trigger must not count generic credit rows as principal')
  assert(src.includes('PAYMENT_EVIDENCE_REQUIRED'), 'wallet engine must reject gateway deposits without provider evidence')
  assert(src.includes("AND NULLIF(trim(COALESCE(t.external_payment_id, '')), '') IS NOT NULL"), 'wallet engine must require provider reference before considering verified deposit evidence')
  assert(src.includes('PAYMENT_VERIFICATION_EVIDENCE_REQUIRED'), 'wallet engine must reject deposits without verified provider backing')
  assert(src.includes("metadata->>'verified_amount_ngn'"), 'wallet engine must require provider-verified amount evidence')
  assert(src.includes('FROM public.pending_payments pp'), 'wallet engine must require Ercas pending-payment evidence for gateway deposits')
  assert(src.includes('FOR UPDATE'), 'wallet engine must lock Ercas pending-payment evidence before consuming it')
  assert(src.includes("SET status = 'credited'"), 'wallet engine must atomically mark Ercas pending-payment evidence credited before trusting it')
  assert(src.includes("lower(COALESCE(pp.status, 'pending')) = 'credited'"), 'wallet engine trusted-principal calculation must trust only consumed/credited Ercas payment evidence')
  assert(!src.includes("lower(COALESCE(pp.status, 'pending')) IN ('pending', 'credited')"), 'wallet engine must not count merely pending Ercas payment evidence as trusted principal')
  assert(src.includes('FROM public.pocketfi_webhook_logs pwl'), 'wallet engine must require PocketFi webhook evidence for bank-transfer deposits')
  assert(src.includes('pwl.matched_user_id = p_user_id'), 'wallet engine must bind PocketFi webhook evidence to the credited user')
  assert(src.includes('ADD COLUMN IF NOT EXISTS verified_amount_ngn numeric'), 'wallet engine migration must add normalized PocketFi verified amount evidence')
  assert(src.includes('ADD COLUMN IF NOT EXISTS verified_reference text'), 'wallet engine migration must add normalized PocketFi verified reference evidence')
  assert(src.includes('v_pocketfi_log public.pocketfi_webhook_logs%ROWTYPE'), 'wallet engine must lock and consume PocketFi webhook evidence')
  assert(src.includes('COALESCE(pwl.processed, false) = false'), 'wallet engine must only consume an unprocessed PocketFi webhook evidence row')
  assert(src.includes('COALESCE(pwl.processed, false) = true'), 'wallet engine trusted-principal calculation must trust only processed PocketFi webhook evidence')
  assert(src.includes("SET processed = true"), 'wallet engine must atomically mark PocketFi webhook evidence processed before trusting it')
  assert(src.includes('round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(t.amount, 2)'), 'wallet engine must match PocketFi verified amount to the posted credit')
  assert(src.includes("NULLIF(trim(COALESCE(pwl.verified_reference, '')), '') IN"), 'wallet engine must match PocketFi verified reference to the posted credit')
  assert(src.includes('WALLET_UNBACKED_FUNDS'), 'missing unbacked funds denial code')
  assert(src.includes('account_suspended = true'), 'unbacked wallet purchase must freeze/suspend financial access')
  const unbackedFreezeBlock = src.slice(
    src.indexOf("IF v_balance_type = 'wallet' AND v_type = 'purchase' THEN"),
    src.indexOf("'code', 'WALLET_UNBACKED_FUNDS'"),
  )
  assert(unbackedFreezeBlock.includes('suspended_at = COALESCE(suspended_at, now())'), 'unbacked wallet purchase must timestamp the durable freeze')
  assert(trigger.includes('guard_trusted_principal_transaction'), 'trusted principal trigger guard must exist for already-deployed wallet engines')
  assert(trigger.includes("current_setting('app.tally_wallet_engine_authorized'"), 'trusted principal guard must run only inside the wallet engine context')
  assert(trigger.includes('v_trusted_available := GREATEST(v_trusted_principal - v_trusted_consumed_spend, 0)'), 'trusted principal trigger must calculate trusted available')
  assert(trigger.includes('PAYMENT_EVIDENCE_REQUIRED'), 'trusted-principal trigger must reject deposit rows without provider evidence')
  assert(trigger.includes("AND NULLIF(trim(COALESCE(t.external_payment_id, '')), '') IS NOT NULL"), 'trusted-principal trigger must require provider reference before considering verified deposit evidence')
  assert(trigger.includes('PAYMENT_VERIFICATION_EVIDENCE_REQUIRED'), 'trusted-principal trigger must reject deposit rows without verified provider backing')
  assert(trigger.includes("metadata->>'verified_amount_ngn'"), 'trusted-principal trigger must require provider-verified amount evidence')
  assert(trigger.includes('FROM public.pending_payments pp'), 'trusted-principal trigger must require Ercas pending-payment evidence')
  assert(trigger.includes("lower(COALESCE(pp.status, 'pending')) = 'credited'"), 'trusted-principal trigger must trust only consumed/credited Ercas payment evidence')
  assert(!trigger.includes("lower(COALESCE(pp.status, 'pending')) IN ('pending', 'credited')"), 'trusted-principal trigger must not count merely pending Ercas payment evidence')
  assert(trigger.includes('FROM public.pocketfi_webhook_logs pwl'), 'trusted-principal trigger must require PocketFi webhook evidence')
  assert(trigger.includes('pwl.matched_user_id = NEW.user_id'), 'trusted-principal trigger must bind PocketFi webhook evidence to the credited user')
  assert(trigger.includes('COALESCE(pwl.processed, false) = true'), 'trusted-principal trigger must count only processed PocketFi webhook evidence')
  assert(trigger.includes('round(COALESCE(pwl.verified_amount_ngn, -1), 2) = round(NEW.amount, 2)'), 'trusted-principal trigger must match PocketFi verified amount to the posted credit')
  assert(trigger.includes("NULLIF(trim(COALESCE(pwl.verified_reference, '')), '') IN"), 'trusted-principal trigger must match PocketFi verified reference to the posted credit')
  assert(trigger.includes('WALLET_UNBACKED_FUNDS'), 'trusted principal trigger must block unbacked purchases')
  assert(src.includes("'trusted_principal_authorized', true"), 'wallet engine must tag authorized purchase debits as trusted-principal backed')
  assert(src.includes("'trusted_principal_debit_amount', v_amount"), 'wallet engine must tag authorized purchase debits with trusted-principal debit amount')
  assert(trigger.includes("'trusted_principal_authorized', true"), 'trusted-principal trigger must tag authorized purchase debits as trusted-principal backed')
  assert(trigger.includes("'trusted_principal_debit_amount', abs(COALESCE(NEW.amount, 0))"), 'trusted-principal trigger must tag authorized purchase debits with trusted-principal debit amount')
  assert(src.includes('REFUND_ORIGINAL_DEBIT_REQUIRED'), 'wallet engine must reject refunds without an original debit link')
  assert(trigger.includes('REFUND_ORIGINAL_DEBIT_REQUIRED'), 'trusted-principal trigger must reject refunds without an original debit link')
  assert(src.includes('REFUND_ORIGINAL_DEBIT_NOT_TRUSTED'), 'wallet engine must reject refunds of untrusted original debits')
  assert(trigger.includes('REFUND_ORIGINAL_DEBIT_NOT_TRUSTED'), 'trusted-principal trigger must reject refunds of untrusted original debits')
  assert(src.includes("p_metadata->>'source_debit_transaction_id'"), 'wallet engine must support refund linkage by original debit transaction id')
  assert(trigger.includes("NEW.metadata->>'source_debit_transaction_id'"), 'trusted-principal trigger must support refund linkage by original debit transaction id')
  assert(src.includes("p_metadata->>'source_debit_idempotency_key'"), 'wallet engine must support refund linkage by purchase idempotency key')
  assert(trigger.includes("NEW.metadata->>'source_debit_idempotency_key'"), 'trusted-principal trigger must support refund linkage by purchase idempotency key')
  assert(src.includes("p_metadata->>'original_reference'"), 'wallet engine must support refund linkage by original purchase reference')
  assert(trigger.includes("NEW.metadata->>'original_reference'"), 'trusted-principal trigger must support refund linkage by original purchase reference')
  assert(src.includes('v_refunded_against_original + v_amount > LEAST'), 'wallet engine must cap refunds against the linked trusted original debit amount')
  assert(trigger.includes('v_refunded_against_original + COALESCE(NEW.amount, 0) > LEAST'), 'trusted-principal trigger must cap refunds against the linked trusted original debit amount')
  assert(!trigger.includes('referral_withdrawal'), 'trusted principal trigger must not count referral withdrawals as principal')
})

check('ordinary insufficient funds decline without fraud suspension', () => {
  const walletEngine = read('supabase/migrations/20260919001000_enforce_backed_wallet_purchases.sql')
  assert(walletEngine.includes("RAISE EXCEPTION 'insufficient_balance'"), 'wallet engine must have a plain insufficient-balance decline')
  assertOrder(
    walletEngine,
    "IF v_new_balance < 0 AND v_type NOT IN ('chargeback', 'correction_debit') THEN",
    "IF v_balance_type = 'wallet' AND v_type = 'purchase' THEN",
    'stored-balance insufficient funds must decline before the unbacked-funds freeze branch',
  )
  const insufficientBlock = walletEngine.slice(
    walletEngine.indexOf("IF v_new_balance < 0 AND v_type NOT IN ('chargeback', 'correction_debit') THEN"),
    walletEngine.indexOf("IF v_balance_type = 'wallet'\n    AND v_type IN ('chargeback', 'correction_debit')"),
  )
  assert(!insufficientBlock.includes('account_suspended'), 'plain insufficient funds must not suspend the account')
  assert(!insufficientBlock.includes('suspension_reason'), 'plain insufficient funds must not create a fraud suspension reason')

  const product = read('supabase/functions/process-purchase/index.ts')
  const productPurchaseMigration = read('supabase/migrations/20260919028000_migrate_product_purchase_reserve_capture.sql')
  const reservationMigration = read('supabase/migrations/20260919025000_create_wallet_reservation_functions.sql')
  assert(product.includes("'authorize_product_purchase'"), 'product purchase route must use the reserve-first authorization boundary')
  assert(reservationMigration.includes("'INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS'"), 'product reserve-first authorization must return a normal insufficient-funds decision')
  assert(!product.includes("type: 'purchase'"), 'product purchase route must not post a direct debit outside the completion boundary')

  const sms = read('supabase/functions/smsbus/index.ts')
  assert(sms.includes("message.includes('insufficient_balance')"), 'SMS route must map insufficient funds to a normal checkout decline')
  assert(sms.includes('Insufficient wallet balance. Required'), 'SMS insufficient funds message must remain a normal wallet-balance decline')

  const telegram = read('supabase/functions/telegram-stars/index.ts')
  assert(telegram.includes("message.includes('insufficient_balance')"), 'Telegram route must map insufficient funds to a normal checkout decline')
  assert(telegram.includes('Insufficient balance. You need'), 'Telegram insufficient funds message must remain a normal wallet-balance decline')
})

check('approved admin credits require a server-side approving actor and explicit approval evidence', () => {
  const walletEngine = read('supabase/migrations/20260919001000_enforce_backed_wallet_purchases.sql')
  const trustedClause = walletEngine.slice(
    walletEngine.indexOf('SELECT COALESCE(SUM(amount), 0)'),
    walletEngine.indexOf('SELECT COALESCE(SUM(abs(amount)), 0)'),
  )
  assert(trustedClause.includes("type = 'admin_credit'"), 'wallet engine must only count admin_credit as approved business principal')
  assert(walletEngine.includes('ADMIN_CREDIT_ADMIN_ACTOR_REQUIRED'), 'wallet engine must reject admin_credit without an admin actor at write time')
  assert(walletEngine.includes('ADMIN_CREDIT_APPROVAL_EVIDENCE_REQUIRED'), 'wallet engine must reject admin_credit without explicit approval metadata at write time')
  assert(walletEngine.includes("p_metadata, '{}'::jsonb)->>'approved_by' IS DISTINCT FROM COALESCE(v_created_by::text"), 'wallet engine must require admin_credit approved_by metadata to match created_by')
  assert(walletEngine.includes("p_metadata, '{}'::jsonb)->>'approval_reference'"), 'wallet engine must require stable admin_credit approval_reference metadata')
  assert(walletEngine.includes("p_metadata, '{}'::jsonb)->>'reason'"), 'wallet engine must require admin_credit reason metadata')
  assert(walletEngine.includes('v_existing.created_by IS DISTINCT FROM v_created_by'), 'wallet idempotency conflict must include created_by actor changes')
  for (const type of ['staff_credit', 'promotion_credit', 'correction_credit']) {
    assert(!trustedClause.includes(`'${type}'`), `wallet engine trusted principal must not count ${type}`)
  }
  assert(trustedClause.includes('FROM public.profiles'), 'admin credits must verify the approving actor against profiles')
  assert(trustedClause.includes('COALESCE(is_admin, false) = true'), 'admin credits must only count when created_by is an admin profile')
  assert(trustedClause.includes("metadata->>'approved_by', '') = t.created_by::text"), 'admin credits must only count when approved_by matches created_by')
  assert(trustedClause.includes("metadata->>'approval_reference', '')"), 'admin credits must only count with approval reference evidence')
  assert(trustedClause.includes("metadata->>'reason', '')"), 'admin credits must only count with reason evidence')
  assert(trustedClause.includes('COALESCE(t.balance_after, 0) > COALESCE(t.balance_before, 0)'), 'admin credits must increase the wallet balance before they can count as trusted principal')
  assert(trustedClause.includes("metadata->>'source', '') <> 'admin-ledger-repair'"), 'admin ledger repair rows must not count as trusted principal')
  assert(trustedClause.includes("metadata->>'balance_unchanged', '') <> 'true'"), 'balance-neutral admin repair rows must not count as trusted principal')
  assert(trustedClause.includes("metadata->>'requires_owner_evidence', '') <> 'true'"), 'owner-evidence repair rows must not count as trusted principal')
  assertOrder(
    trustedClause,
    "type = 'admin_credit'",
    'COALESCE(is_admin, false) = true',
    'trusted admin-credit clause must require admin actor evidence',
  )

  for (const path of [
    'supabase/migrations/20260919004000_harden_fraud_credit_evidence.sql',
    'supabase/migrations/20260919015000_enforce_trusted_principal_transaction_guard.sql',
  ]) {
    const src = read(path)
    assert(src.includes("= 'admin_credit'"), `${path} must trust only admin_credit business principal`)
    assert(src.includes('COALESCE(is_admin, false) = true'), `${path} must require admin actor evidence for admin_credit principal`)
    assert(src.includes("metadata->>'approved_by', '') = t.created_by::text"), `${path} must require approved_by metadata for admin_credit principal`)
    assert(src.includes("metadata->>'approval_reference', '')"), `${path} must require approval_reference metadata for admin_credit principal`)
    assert(src.includes("metadata->>'reason', '')"), `${path} must require reason metadata for admin_credit principal`)
    assert(
      src.includes('COALESCE(balance_after, 0) > COALESCE(balance_before, 0)') ||
        src.includes('COALESCE(t.balance_after, 0) > COALESCE(t.balance_before, 0)'),
      `${path} must require admin_credit to increase balance before trusting it`,
    )
    assert(src.includes("metadata->>'source', '') <> 'admin-ledger-repair'"), `${path} must exclude balance-neutral admin repair rows from trusted principal`)
    for (const type of ['staff_credit', 'promotion_credit', 'correction_credit']) {
      assert(!src.includes(`'${type}'`), `${path} must not count ${type} as trusted principal`)
    }
  }

  const adminAdjust = read('supabase/functions/admin-adjust-balance/index.ts')
  assert(adminAdjust.includes('p_created_by: params.createdBy || null'), 'admin-adjust wrapper must pass createdBy into wallet engine')
  assert(adminAdjust.includes('created_by, external_payment_id'), 'admin unsuspend backing must load provider payment reference')
  assert(adminAdjust.includes(".from('pending_payments')"), 'admin unsuspend backing must load Ercas pending-payment evidence')
  assert(adminAdjust.includes(".from('pocketfi_webhook_logs')"), 'admin unsuspend backing must load PocketFi webhook evidence')
  assert(adminAdjust.includes('balance_before, balance_after'), 'admin unsuspend backing must load balance snapshots for admin-credit trust checks')
  assert(adminAdjust.includes('function isVerifiedGatewayCredit'), 'admin unsuspend backing must centralize verified gateway credit checks')
  assert(adminAdjust.includes('metadata.verified_amount_ngn'), 'admin unsuspend backing must require provider-verified amount metadata')
  assert(adminAdjust.includes('pendingPayments.some'), 'admin unsuspend backing must require matching pending-payment evidence for Ercas deposits')
  assert(adminAdjust.includes("String(payment.status || 'pending').toLowerCase() === 'credited'"), 'admin unsuspend backing must not count merely pending Ercas payment evidence as trusted principal')
  assert(adminAdjust.includes('pocketfiWebhookLogs.some'), 'admin unsuspend backing must require matching PocketFi webhook evidence')
  assert(adminAdjust.includes('Boolean(log.processed) === true'), 'admin unsuspend backing must require processed PocketFi webhook evidence')
  assert(adminAdjust.includes('toCents(log.verified_amount_ngn) === toCents(amount)'), 'admin unsuspend backing must require matching PocketFi verified amount evidence')
  assert(adminAdjust.includes('log.verified_reference'), 'admin unsuspend backing must require matching PocketFi verified reference evidence')
  assert(adminAdjust.includes('const isBalanceNeutralAdminRepair'), 'admin unsuspend backing must identify balance-neutral admin repair evidence')
  assert(adminAdjust.includes("metadata.source || '') === 'admin-ledger-repair'"), 'admin unsuspend backing must exclude admin ledger repair evidence from trusted principal')
  assert(adminAdjust.includes('balanceAfter <= balanceBefore'), 'admin unsuspend backing must require approved admin credits to increase the balance')
  assert(adminAdjust.includes('.eq(\'is_admin\', true)'), 'admin unsuspend review must verify admin_credit actors are admins')
  assert(adminAdjust.includes('function hasApprovedAdminCreditEvidence'), 'admin unsuspend review must require explicit admin-credit approval metadata')
  assert(adminAdjust.includes('metadata.approved_by'), 'admin unsuspend review must require admin_credit approved_by metadata')
  assert(adminAdjust.includes('metadata.approval_reference'), 'admin unsuspend review must require admin_credit approval_reference metadata')
  assert(adminAdjust.includes('createdBy: user.id'), 'admin adjustments must use the authenticated admin as approving actor')
  assert(adminAdjust.includes("approval_type: 'direct_admin_adjustment'"), 'direct admin credits must record direct admin approval type')
  assert(adminAdjust.includes('approval_reference: idempotency_key || adjustmentReference'), 'direct admin credits must record a stable approval reference')
  assert(adminAdjust.includes("type: 'admin_credit'"), 'admin ledger repair credits must be explicitly typed')
  assert(adminAdjust.includes('created_by: user.id'), 'admin ledger repair records must carry the authenticated admin actor')

  const manageStaff = read('supabase/functions/manage-staff/index.ts')
  assert(manageStaff.includes('p_created_by: params.createdBy || null'), 'manage-staff wrapper must pass createdBy into wallet engine')
  assert(manageStaff.includes("if (!isAdmin && actionType === 'adjust_balance')"), 'staff balance adjustments must require admin review')
  assert(manageStaff.includes("const transactionType = amount > 0 ? 'admin_credit' : 'admin_debit'"), 'approved staff balance increases must post as admin_credit')
  assert(manageStaff.includes('Admin approval is required before staff balance credits can become spendable'), 'staff credits must fail without admin approval evidence')
  assert(manageStaff.includes('createdBy: approvingAdminId || pendingAction.staff_id || undefined'), 'staff adjustment credits must carry approving admin actor when positive')
  assert(manageStaff.includes("approval_type: 'staff_action_review'"), 'admin-approved staff credits must record staff action approval type')
  assert(manageStaff.includes('approval_reference: pendingAction.id || reference'), 'admin-approved staff credits must record stable approval reference')

  const browser = read('src/lib/supabase.ts')
  assert(browser.includes('_adminEmail: string, // Kept for backwards compatibility, but verified server-side'), 'browser admin adjustment must not send a trusted approver identity')
  assert(!browser.includes('created_by: user.id'), 'browser helper must not manufacture created_by evidence')

  const adminPage = read('src/pages/AdminPage.tsx')
  assert(adminPage.includes('function isTrustedCreditTransaction'), 'admin fraud review must define the trusted-credit helper')
  assert(adminPage.includes('function isVerifiedGatewayCreditTransaction'), 'admin fraud review must centralize verified gateway credit checks')
  assert(adminPage.includes('function isBalanceNeutralAdminRepair'), 'admin fraud review must identify balance-neutral admin repair evidence')
  assert(adminPage.includes('const adminActorIds = new Set'), 'admin fraud review must build admin actor evidence from profiles')
  assert(adminPage.includes("readRows('pending_payments'"), 'admin fraud review must load pending payment evidence')
  assert(adminPage.includes("readRows('pocketfi_webhook_logs'"), 'admin fraud review must load PocketFi webhook evidence')
  assert(adminPage.includes('pendingEvidenceByUser'), 'admin fraud review must index pending payment evidence by user')
  assert(adminPage.includes('pocketfiLogsById'), 'admin fraud review must index PocketFi webhook evidence by id')
  assert(adminPage.includes("String(payment.status || 'pending').toLowerCase() === 'credited'"), 'admin fraud review must not count merely pending Ercas payment evidence as trusted principal')
  assert(adminPage.includes('metadata.verified_amount_ngn'), 'admin fraud review must require provider-verified amount metadata')
  assert(adminPage.includes('Boolean(webhookLog.processed) === true'), 'admin fraud review must require processed PocketFi webhook evidence')
  assert(adminPage.includes('toLedgerCents(webhookLog.verified_amount_ngn) === toLedgerCents(amount)'), 'admin fraud review must require matching PocketFi verified amount evidence')
  assert(adminPage.includes('webhookLog.verified_reference'), 'admin fraud review must require matching PocketFi verified reference evidence')
  assert(adminPage.includes('function findLinkedTrustedDebit'), 'admin fraud review must link refunds to original trusted debits')
  assert(adminPage.includes('metadata.trusted_principal_authorized'), 'admin fraud review must only treat trusted-principal-authorized debits as refundable capacity')
  assert(adminPage.includes('metadata.trusted_principal_debit_amount'), 'admin fraud review must require trusted-principal debit amount evidence')
  assert(adminPage.includes('ledger.completedRefundRows.push(tx)'), 'admin fraud review must preserve refund rows for linkage instead of only aggregating amounts')
  assert(adminPage.includes('const original = findLinkedTrustedDebit(refund, ledger.trustedDebits)'), 'admin fraud review must match refunds against trusted debit evidence')
  assert(adminPage.includes('ledger.linkedEligibleRefunds = Array.from(refundedByOriginal.values()).reduce'), 'admin fraud review must calculate linked eligible refunds separately')
  assert(!adminPage.includes('const eligibleRefunds = Math.min(ledger.completedRefunds, trustedDebitCapacity)'), 'admin fraud review must not treat aggregate completed refunds as eligible restoration')
  assert(adminPage.includes('adminActorIds.has(createdBy)'), 'admin fraud review must verify admin_credit actors are admins')
  assert(adminPage.includes('hasApprovingAdminActor && !isBalanceNeutralAdminRepair(tx)'), 'admin fraud review must exclude admin repair rows from trusted principal')
  assert(adminPage.includes("if (isWalletSpendTransaction(tx)) return -absoluteAmount"), 'admin user detail transactions must render admin_debit and other spends as negative amounts')
  assert(adminPage.includes('const signedAmount = getWalletTransactionDisplayAmount(tx)'), 'admin user detail transaction rows must use the signed display amount helper')
  assert(adminPage.includes('const isCredit = signedAmount > 0'), 'admin user detail transaction rows must derive credit styling from signed amount')
  assert(adminPage.includes('const isSpend = signedAmount < 0'), 'admin user detail transaction rows must derive debit styling from signed amount')
  assert(adminPage.includes("{isCredit ? '+' : isSpend ? '-' : ''}"), 'admin user detail transaction rows must render debit signs from signed amount')
  assert(adminPage.includes("'wallet_deposit', 'admin_credit'"), 'admin user history may show approved admin_credit funding rows')
  assert(!adminPage.includes("'wallet_deposit', 'credit', 'admin_credit', 'staff_credit'"), 'admin user history must not label generic or staff_credit rows as deposits')
  assert(!adminPage.includes('description.includes(needle)'), 'admin fraud review must not trust credit/deposit wording in descriptions')
  const adminReviewModel = read('scripts/wallet-admin-review-decision-test.mjs')
  assert(adminReviewModel.includes("metadata.provider === 'pocketfi'"), 'admin review model must include PocketFi gateway evidence path')
  assert(adminReviewModel.includes('entry.providerEvidence.processed === true'), 'admin review model must require processed PocketFi evidence')
  assert(adminReviewModel.includes('toCents(entry.providerEvidence.amount) === toCents(amount)'), 'admin review model must require matching PocketFi amount evidence')
  assert(adminReviewModel.includes('entry.providerEvidence.reference'), 'admin review model must require matching PocketFi reference evidence')
  const trustedCreditHelper = adminPage.slice(
    adminPage.indexOf('function isTrustedCreditTransaction'),
    adminPage.indexOf('function isTrustedCryptoCreditTransaction'),
  )
  assert(!trustedCreditHelper.includes("'credit'"), 'admin fraud review must not treat generic credit as trusted principal')
  for (const type of ['staff_credit', 'promotion_credit', 'correction_credit']) {
    assert(!trustedCreditHelper.includes(`'${type}'`), `admin fraud review must not treat ${type} as trusted principal`)
  }
  assert(trustedCreditHelper.includes('isVerifiedGatewayCreditTransaction'), 'admin fraud review must require verified provider evidence for deposit principal')
  assert(trustedCreditHelper.includes('!isBalanceNeutralAdminRepair(tx)'), 'admin fraud review must not count audit-only admin repair rows as trusted principal')

  const adminReviewTest = read('scripts/wallet-admin-review-decision-test.mjs')
  const pkg = read('package.json')
  assert(pkg.includes('"security:wallet:admin-review": "node scripts/wallet-admin-review-decision-test.mjs"'), 'package script must expose admin review decision tests')
  assert(adminReviewTest.includes('verified gateway deposits and approved admin credits create trusted principal'), 'admin review test must cover trusted principal sources')
  assert(adminReviewTest.includes('generic, staff, promotion, unapproved admin, and balance-neutral repair credits are excluded'), 'admin review test must exclude untrusted credit shapes')
  assert(adminReviewTest.includes("normalize(entry.providerEvidence.status) === 'credited'"), 'admin review model must not count merely pending Ercas payment evidence as trusted principal')
  assert(adminReviewTest.includes('refunds restore previous trusted debit capacity without becoming principal'), 'admin review test must keep refunds out of principal')
  assert(adminReviewTest.includes('linkedEligibleRefunds'), 'admin review test must report linked eligible refunds separately from raw refunds')
  assert(adminReviewTest.includes('loose refund must not restore trusted balance'), 'admin review test must prove loose refunds do not restore trusted balance')
  assert(adminReviewTest.includes('unbacked wallets cannot be unsuspended by balance editing'), 'admin review test must block unbacked unsuspension')
  assert(adminReviewTest.includes('unknown supplier outcomes block reinstatement'), 'admin review test must block review while supplier exposure is unknown')
  assert(adminReviewTest.includes('staff credit requests queue for admin review'), 'admin review test must prevent staff credit requests from immediately creating trusted principal')
  assert(adminReviewTest.includes('admin and staff debits render negative even when stored with positive amounts'), 'admin review test must cover positive stored debits rendering negative')
  assert(adminReviewTest.includes('generic and staff credits are not labelled as deposit history'), 'admin review test must cover deposit-history credit classification')
})

check('incoming funds can be recorded while frozen without auto-unfreeze', () => {
  const walletEngine = read('supabase/migrations/20260919001000_enforce_backed_wallet_purchases.sql')
  const fraudEvidence = read('supabase/migrations/20260919004000_harden_fraud_credit_evidence.sql')
  const fraudRescan = read('supabase/migrations/20260919019000_rescan_wallet_integrity_after_hardening.sql')
  assert(walletEngine.includes('IF COALESCE(v_profile.account_suspended, false)'), 'wallet engine must explicitly check frozen accounts')
  assert(walletEngine.includes('AND v_signed_amount < 0'), 'frozen-account block must apply only to outgoing value')
  assert(walletEngine.includes("AND v_type NOT IN ('chargeback', 'correction_debit')"), 'chargeback/correction debt must still be recordable while frozen')
  assert(walletEngine.includes("RAISE EXCEPTION 'wallet_transaction_account_suspended'"), 'outgoing frozen-wallet attempts must fail closed')
  const frozenBlock = walletEngine.slice(
    walletEngine.indexOf('IF COALESCE(v_profile.account_suspended, false)'),
    walletEngine.indexOf("IF v_balance_type = 'crypto' THEN"),
  )
  assert(!frozenBlock.includes("v_type IN ('topup'"), 'frozen-wallet check must not block incoming topups')
  assert(!frozenBlock.includes("v_type IN ('refund'"), 'frozen-wallet check must not block incoming refunds')
  assert(!walletEngine.includes('account_suspended = false'), 'wallet engine must not automatically unfreeze after a later credit')
  assert(!fraudEvidence.includes('account_suspended = false'), 'fraud ledger scanner must not automatically unsuspend accounts')
  for (const path of [
    'supabase/migrations/20260914006000_normalize_ledger_suspension_checks.sql',
    'supabase/migrations/20260914011000_harden_crypto_transfer_and_fraud_credits.sql',
    'supabase/migrations/20260917004000_count_refunds_as_fraud_credits.sql',
    'supabase/migrations/202609170050_enforce_profile_balance_authority.sql',
  ]) {
    const historicalScanner = read(path)
    assert(!historicalScanner.includes('account_suspended = false'), `${path} must not auto-unsuspend during migration replay`)
  }
  const resetSuspensions = read('supabase/migrations/20260914012000_reset_auto_fraud_suspensions.sql')
  assert(resetSuspensions.includes('intentionally performs no data mutation'), 'auto fraud reset migration must remain a no-op during incident hardening')
  assert(!resetSuspensions.includes('SET account_suspended = false'), 'auto fraud reset migration must not clear financial holds')
  assert(!resetSuspensions.includes('SET active = false'), 'auto fraud reset migration must not clear fraud device bans')
  assert(fraudRescan.includes('public.evaluate_customer_ledger_suspension(customer.id, 1)'), 'deployment hardening must rescan existing customer wallets with the hardened evaluator')
  assertOrder(fraudRescan, 'scanned_count := scanned_count + 1', 'public.evaluate_customer_ledger_suspension(customer.id, 1)', 'deployment hardening rescan must count attempted wallets even when evaluation fails')
  assert(!fraudRescan.includes('account_suspended = false'), 'deployment hardening rescan must not auto-unsuspend customers')
  assert(fraudRescan.includes('WHEN OTHERS THEN') && fraudRescan.includes('wallet integrity could not be verified during hardening deployment'), 'deployment hardening rescan must fail closed when a wallet cannot be evaluated')
  assert(fraudRescan.includes('fail_closed_count := fail_closed_count + 1'), 'deployment hardening rescan must report fail-closed review freezes')
  assert(fraudRescan.includes('fail_closed=%'), 'deployment hardening rescan notice must include fail-closed freeze count')
  assert(fraudRescan.includes("set_config('app.tally_profile_privileged_authorized', 'true'"), 'deployment hardening rescan must use the narrow profile privileged-write flag for review freezes')
  assert(fraudRescan.includes('COALESCE(is_admin, false) = false') && fraudRescan.includes('COALESCE(is_staff, false) = false'), 'deployment hardening rescan must target ordinary customer wallets only')
  assert(!fraudEvidence.includes("'deposit',\n        'credit'"), 'fraud ledger scanner must not count generic credit rows as trusted principal')
  assert(fraudEvidence.includes("set_config('app.tally_profile_privileged_authorized', 'true'"), 'fraud ledger scanner must use the narrow profile privileged-write flag before suspension updates')
  assert(fraudEvidence.includes("set_config('app.tally_profile_privileged_authorized', 'false'"), 'fraud ledger scanner must clear the profile privileged-write flag after suspension updates')
  assert(fraudEvidence.includes("metadata->>'verified_amount_ngn'"), 'fraud ledger scanner must require provider-verified amount metadata')
  assert(fraudEvidence.includes('FROM public.pending_payments pp'), 'fraud ledger scanner must require Ercas pending-payment evidence')
  assert(fraudEvidence.includes('FROM public.pocketfi_webhook_logs pwl'), 'fraud ledger scanner must require PocketFi webhook evidence')
  assert(fraudEvidence.includes('pwl.matched_user_id = t.user_id'), 'fraud ledger scanner must bind PocketFi evidence to the credited user')

  const verifyErcas = read('supabase/functions/verify-and-credit-wallet/index.ts')
  assert(verifyErcas.includes("type: 'topup'"), 'Ercas verified topups must post through wallet engine')
  assert(verifyErcas.includes('credited_via: \'normal\''), 'Ercas verified topups must remain normal funding evidence, not an unfreeze action')

  const pocketfi = read('supabase/functions/webhook-pocketfi/index.ts')
  assert(pocketfi.includes("type: 'topup'"), 'PocketFi verified topups must post through wallet engine')
  assert(pocketfi.includes('verified_amount_ngn: amount'), 'PocketFi webhook must persist provider-verified amount evidence')
  assert(pocketfi.includes('verified_reference: reference'), 'PocketFi webhook must persist provider-verified reference evidence')
  assert(pocketfi.includes('webhook_log_id: logRow?.id || null'), 'PocketFi topups must bind ledger entries to webhook evidence')
  assert(!pocketfi.includes('account_suspended = false'), 'PocketFi topups must not auto-unfreeze customers')
  assert(!verifyErcas.includes('account_suspended = false'), 'Ercas topups must not auto-unfreeze customers')
})

check('wallet refunds are capped by trusted original debits', () => {
  const src = read('supabase/migrations/20260919001000_enforce_backed_wallet_purchases.sql')
  assert(src.includes("v_type IN ('refund', 'purchase_refund', 'auto_refund')"), 'wallet engine must identify refund-like credits')
  assert(src.includes('v_refundable_remaining := GREATEST(v_trusted_debit_capacity - v_completed_refunds, 0)'), 'wallet engine must calculate refundable remaining from trusted debit capacity')
  assert(src.includes('eligible_refund_matches'), 'wallet engine must not count unlinked historical refunds as trusted restoration')
  assert(src.includes('source_debit_transaction_id'), 'wallet engine refunds must support original debit transaction linkage')
  assert(src.includes('source_debit_idempotency_key'), 'wallet engine refunds must support original debit idempotency linkage')
  assert(src.includes('original_purchase_idempotency_key'), 'wallet engine refunds must support original purchase idempotency linkage')
  assert(src.includes('REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT'), 'wallet engine must reject refunds that exceed trusted original debit')
})

check("refund paths credit the original order owner's wallet", () => {
  const telegram = read('supabase/functions/telegram-stars/index.ts')
  assert(/async function refundWallet\(admin: SupabaseAdmin, order: \{[^}]*user_id: string[^}]*\}, reason: string/.test(telegram), 'Telegram refunds must accept an order carrying user_id')
  assert(telegram.includes('userId: order.user_id'), 'Telegram refunds must credit order.user_id')
  assert(telegram.includes('idempotencyKey: `telegram:refund:${order.id}`'), 'Telegram refunds must use order-bound idempotency')
  assert(telegram.includes("source_order_id: order.id") && telegram.includes("source_order_table: 'telegram_orders'"), 'Telegram refunds must keep normalized source order metadata')
  assert(telegram.includes(".select('*').eq('id', orderId).single()"), 'Telegram admin refund must load the target order by id before refunding')

  const sms = read('supabase/functions/smsbus/index.ts')
  assert(/async function refundWallet\(admin: SupabaseAdmin, order: \{[^}]*user_id: string[^}]*\}, reason: string/.test(sms), 'SMS refunds must accept an order carrying user_id')
  assert(sms.includes('userId: order.user_id'), 'SMS refunds must credit order.user_id')
  assert(sms.includes('idempotencyKey: `sms:refund:${refundRef}`'), 'SMS refunds must use order/reference-bound idempotency')
  assert(sms.includes("source_order_id: order.id") && sms.includes("source_order_table: 'sms_orders'"), 'SMS refunds must keep normalized source order metadata')
  assert(sms.includes('await refundWallet(admin, order, `Admin refund for cancelled SMS order: ${order.reference}`)'), 'SMS admin cancellation must refund the loaded order owner')

  const manageStaff = read('supabase/functions/manage-staff/index.ts')
  assert(manageStaff.includes('refundSmsOrderWallet(admin: any, order: any, reason: string, metadata: Record<string, unknown> = {})'), 'Staff SMS refunds must accept approval metadata')
  assert(manageStaff.includes('userId: order.user_id'), 'Staff SMS refunds must credit order.user_id')
  assert(manageStaff.includes('idempotencyKey: `staff:sms-refund:${order.id}`'), 'Staff SMS refunds must use order-bound idempotency')
  assert(manageStaff.includes('...metadata'), 'Staff SMS refunds must preserve approval metadata on the ledger row')
  assert(manageStaff.includes("source_order_id: order.id") && manageStaff.includes("source_order_table: 'sms_orders'"), 'Staff SMS refunds must keep normalized source order metadata')
  assert(manageStaff.includes('const approvingAdminId = pendingAction.reviewed_by || pendingAction.admin_id || null'), 'Staff SMS refund workflow must resolve approving admin evidence')
  assert(manageStaff.includes('approved_by: approvingAdminId'), 'Staff SMS refund ledger metadata must include approving admin evidence')
  assert(manageStaff.includes('pending_action_id: pendingAction.id || null'), 'Staff SMS refund ledger metadata must include pending action evidence')

  const smmStatus = read('supabase/functions/smm-check-status/index.ts')
  const smmAll = read('supabase/functions/smm-check-all-orders/index.ts')
  for (const [label, src] of [['smm-check-status', smmStatus], ['smm-check-all-orders', smmAll]]) {
    assert(src.includes('userId: order.user_id'), `${label} refunds must credit order.user_id`)
    assert(src.includes('idempotencyKey: `smm:refund:${order.id}:${newStatus}`'), `${label} refunds must use order/status-bound idempotency`)
    assert(src.includes('source_order_id: order.id') && src.includes("source_order_table: 'smm_orders'"), `${label} refunds must keep normalized source order metadata`)
    assert(src.includes('eventId: `') && src.includes('PRODUCT_PURCHASE_REVERSED:${order.id}:${newStatus}`'), `${label} reversal events must bind to the original order`)
  }

  const bills = read('supabase/functions/purchase-bills/index.ts')
  assert(bills.includes('user_id: user.id'), 'Bills order records must be created for the authenticated user')
  assert(bills.includes('userId: user.id'), 'Bills provider-failure refunds must credit the authenticated order creator')
  assert(bills.includes('idempotencyKey: `bills:refund:${billRecord.id}:provider-returned-failed`'), 'Bills returned-failed refunds must bind to the local bill record')
  assert(bills.includes('idempotencyKey: `bills:refund:${billRecord.id}:provider-error`'), 'Bills provider-error refunds must bind to the local bill record')
  assert(bills.includes('source_order_id: billRecord.id') && bills.includes("source_order_table: 'bills_transactions'"), 'Bills refunds must keep normalized source transaction metadata')

  const bitrefill = read('supabase/functions/purchase-bitrefill/index.ts')
  assert(bitrefill.includes('user_id: user.id'), 'Bitrefill order records must be created for the authenticated user')
  assert(bitrefill.includes('userId: user.id'), 'Bitrefill provider-failure refunds must credit the authenticated order creator')
  assert(bitrefill.includes('idempotencyKey: `bitrefill:refund:${orderRecord.id}:provider-declined`'), 'Bitrefill declined refunds must bind to the local order record')
  assert(bitrefill.includes('idempotencyKey: `bitrefill:refund:${orderRecord.id}:provider-error`'), 'Bitrefill provider-error refunds must bind to the local order record')
  assert(bitrefill.includes('source_order_id: orderRecord.id') && bitrefill.includes("source_order_table: 'bitrefill_orders'"), 'Bitrefill refunds must keep normalized source order metadata')
})

check('refund paths carry original debit provenance', () => {
  const product = read('supabase/functions/process-purchase/index.ts')
  const productPurchaseMigration = read('supabase/migrations/20260919028000_migrate_product_purchase_reserve_capture.sql')
  assert(product.includes("'complete_product_purchase'"), 'Product completion must use the database capture boundary')
  assert(productPurchaseMigration.includes("'source_order_id', p_order_id"), 'Product capture metadata must link the debit to the original order')

  const smm = read('supabase/functions/smm-create-order/index.ts')
  assert(smm.includes('source_debit_transaction_id: debitResult?.transaction?.id || null'), 'SMM immediate refunds must link to the original debit transaction id')
  assert(smm.includes('source_debit_idempotency_key: `smm:purchase:${idempotency_key}`'), 'SMM immediate refunds must link to the original purchase idempotency key')

  const bills = read('supabase/functions/purchase-bills/index.ts')
  assert(bills.includes('source_debit_transaction_id: debitResult?.transaction?.id || null'), 'Bills refunds must link to the original debit transaction id')
  assert(bills.includes('source_debit_idempotency_key: `bills:purchase:${idempotency_key}`'), 'Bills refunds must link to the original purchase idempotency key')

  const bitrefill = read('supabase/functions/purchase-bitrefill/index.ts')
  assert(bitrefill.includes('source_debit_transaction_id: debitResult?.transaction?.id || null'), 'Bitrefill refunds must link to the original debit transaction id')
  assert(bitrefill.includes('source_debit_idempotency_key: `bitrefill:purchase:${idempotency_key}`'), 'Bitrefill refunds must link to the original purchase idempotency key')

  const withdrawal = read('supabase/functions/create-withdrawal-request/index.ts')
  assert(withdrawal.includes('const debitIdempotencyKey = `withdrawal:${withdrawalRecord.id}`'), 'Withdrawal route must keep a stable original debit idempotency key')
  assert(withdrawal.includes('source_debit_transaction_id: debitResult?.transaction?.id || null'), 'Withdrawal refunds must link to the original debit transaction id')
  assert(withdrawal.includes('source_debit_idempotency_key: debitIdempotencyKey'), 'Withdrawal refunds must link to the original withdrawal debit idempotency key')
  assert(withdrawal.includes('original_reference: reference'), 'Withdrawal refunds must keep the original debit reference')

  const telegram = read('supabase/functions/telegram-stars/index.ts')
  assert(telegram.includes('original_reference: order.reference'), 'Telegram refunds must keep the original debit reference for deferred callbacks')
  assert(telegram.includes("source_order_table: 'telegram_orders'"), 'Telegram refunds must keep source-order provenance for deferred callbacks')

  const sms = read('supabase/functions/smsbus/index.ts')
  assert(sms.includes('original_reference: order.reference'), 'SMS refunds must keep the original debit reference for deferred callbacks')
  assert(sms.includes("source_order_table: 'sms_orders'"), 'SMS refunds must keep source-order provenance for deferred callbacks')
})

check('wallet chargebacks preserve debt and freeze spending', () => {
  const src = read('supabase/migrations/20260919001000_enforce_backed_wallet_purchases.sql')
  const adminAdjust = read('supabase/functions/admin-adjust-balance/index.ts')
  const adminPage = read('src/pages/AdminPage.tsx')
  const client = read('src/lib/supabase.ts')
  const regressionMatrix = read('docs/security/wallet-regression-matrix.md')
  assert(src.includes("v_type NOT IN ('chargeback', 'correction_debit')"), 'chargebacks/correction debits must bypass ordinary negative-balance rejection')
  assert(src.includes("v_type IN ('chargeback', 'correction_debit')"), 'wallet engine must identify debt-posting debits')
  assert(src.includes('posted a debt balance'), 'chargeback/correction debt must freeze with an explicit reason')
  assert(src.includes('account_suspended = true'), 'chargeback/correction debt must freeze account spending')
  assert(adminAdjust.includes("body?.action === 'record_chargeback'"), 'admin adjustment route must expose a controlled chargeback action')
  assert(adminAdjust.includes('A chargeback reference with at least 3 characters is required'), 'admin chargeback must require a stable provider/dispute reference')
  assert(adminAdjust.includes('`chargeback:${targetUserId}:${chargebackReference}`'), 'admin chargeback must use a deterministic idempotency key from the chargeback reference')
  assert(adminAdjust.includes("type: 'chargeback'"), 'admin chargeback action must post through wallet engine as chargeback')
  assert(adminAdjust.includes('admin-record-chargeback'), 'admin chargeback must carry source metadata')
  assert(adminAdjust.includes('set_customer_suspension_state'), 'admin chargeback must put account into review after reversal evidence')
  assert(adminAdjust.includes('Chargeback was recorded but account review state could not be set'), 'admin chargeback must fail loudly if review state cannot be set')
  assert(client.includes('adminRecordChargeback'), 'client admin helper must expose controlled chargeback recording')
  assert(client.includes('idempotency_key: `chargeback-${userId}-${cleanReference}`'), 'client chargeback helper must use reference-based duplicate protection')
  assert(adminPage.includes('<SelectItem value="chargeback">Record Chargeback</SelectItem>'), 'admin UI must show chargeback as a distinct action')
  assert(adminPage.includes('Chargeback Reference'), 'admin UI must collect chargeback provider/dispute reference')
  assert(adminPage.includes('Records a chargeback through the wallet engine'), 'admin UI must explain chargeback review behavior')
  const adminReviewTest = read('scripts/wallet-admin-review-decision-test.mjs')
  for (const needle of [
    'CHARGEBACK_REFERENCE_REQUIRED',
    'CHARGEBACK_ALREADY_RECORDED',
    'POST_CHARGEBACK',
    'trustedPrincipalCreated === false',
    'walletFrozenAfter === true',
    "displayTransactionAmount({ type: 'chargeback'",
  ]) {
    assert(adminReviewTest.includes(needle), `admin chargeback model test missing ${needle}`)
  }
  assert(regressionMatrix.includes('manual `Record Chargeback` workflow'), 'regression matrix must document the manual chargeback workflow')
  assert(regressionMatrix.includes('Provider-automated chargeback ingestion'), 'regression matrix must keep provider chargeback ingestion marked as external proof')
})

check('admin unsuspend requires wallet backing reconciliation', () => {
  const src = read('supabase/functions/admin-adjust-balance/index.ts')
  assert(src.includes('calculateWalletBacking'), 'admin unsuspend must calculate wallet backing before reinstatement')
  assert(src.includes('WALLET_REVIEW_REQUIRED'), 'admin unsuspend must fail closed when backing review fails')
  assert(src.includes('storedWalletBalance > unsuspendReview.backedAvailable'), 'admin unsuspend must compare stored balance with backed funds')
  assert(src.includes('trustedCredits'), 'admin unsuspend review must include trusted credit evidence')
  assert(src.includes('eligibleRefunds'), 'admin unsuspend review must include eligible refund evidence')
  assert(src.includes('findLinkedTrustedDebit'), 'admin unsuspend review must link refunds to trusted original debits')
  assert(src.includes('linkedEligibleRefunds'), 'admin unsuspend review must report linked eligible refund evidence')
  assert(!src.includes('const eligibleRefunds = Math.min(completedRefunds, trustedDebitCapacity)'), 'admin unsuspend backing must not treat aggregate completed refunds as eligible restoration')
  assert(src.includes('const hasTransactionIdempotencyKey = await transactionsHaveIdempotencyKey(supabaseAdmin)'), 'admin unsuspend backing must probe transaction idempotency column before selecting it')
  assert(src.includes('.select(transactionSelect)'), 'admin unsuspend backing must use schema-safe transaction select list')
  assert(src.includes('processed, verified_amount_ngn, verified_reference'), 'admin unsuspend PocketFi evidence query must select every field it validates')
  assert(src.includes(".or('balance_type.eq.wallet,balance_type.is.null')"), 'admin unsuspend review must include legacy wallet ledger rows')
  assert(!src.includes("'deposit',\n        'credit'"), 'admin unsuspend backing must not count generic credit rows as trusted funds')
})

check('direct ledger writes are skipped and audited', () => {
  const src = read('supabase/migrations/20260919005000_guard_transaction_ledger_authority.sql')
  assert(src.includes('transaction_ledger_blocked_attempts'), 'missing blocked ledger attempt table')
  assert(src.includes("current_setting('app.tally_wallet_engine_authorized'"), 'missing wallet engine transaction flag check')
  assert(src.includes('WHERE p.id = NEW.created_by') && src.includes('COALESCE(p.is_admin, false) = true'), 'balance-neutral admin repair ledger rows must require an admin created_by actor')
  assert(src.includes('RETURN NULL'), 'direct ledger writes must be skipped so audit survives')
})

check('staging DB security test pack covers dangerous wallet paths', () => {
  const src = read('docs/security/wallet-db-security-test-pack.sql')
  for (const needle of [
    'SET LOCAL ROLE authenticated',
    'apply_wallet_transaction',
    'transaction_ledger_blocked_attempts',
    'wallet_security_events',
    'DIRECT_LEDGER_WRITE_BLOCKED',
    'direct transaction insert did not create wallet_security_events forensic row',
    'WALLET_UNBACKED_FUNDS',
    'unbacked purchase freeze did not create wallet_security_events forensic row',
    'IDEMPOTENCY_CONFLICT',
    'ARRAY[500000, 450000, 789292, 1]',
    'wallet-db-security-test:engine-profile:topup',
    'wallet-engine topup did not consume pending payment evidence',
    'wallet-engine topup did not update profile balance',
    'wallet-db-security-test:deposit-without-provider-evidence',
    'PAYMENT_EVIDENCE_REQUIRED',
    'non-admin balance-neutral admin repair row was inserted',
    'non-admin balance-neutral admin repair row was not audited as a blocked direct ledger attempt',
    'wallet-db-security-test:engine-profile:purchase',
    'wallet-engine purchase row was not signed/snapshotted correctly',
    'direct service-role profile update changed protected fields',
    'narrow profile RPCs changed unexpected fields',
    'non-admin actor changed suspension state through narrow RPC',
    'non-admin actor changed staff role through narrow RPC',
    'unauthorized narrow RPC attempt changed profile state',
    'set_customer_pocketfi_account',
    'apply_profile_referral_attribution',
    'set_customer_suspension_state',
    'set_staff_role',
    'wallet-db-security-test:unapproved-admin-credit',
    'wallet-db-security-test:non-admin-admin-credit',
    'ADMIN_CREDIT_ADMIN_ACTOR_REQUIRED',
    "ARRAY['staff_credit', 'promotion_credit', 'correction_credit']",
    "'wallet-db-security-test:untrusted:' || v_type",
    'wallet-db-security-test:generic-credit-not-principal',
    'generic credit was trusted or did not trigger review',
    'wallet-db-security-test:fraud-scanner-no-auto-unsuspend',
    'fraud scanner auto-unsuspended an existing review',
    'public auth.users foreign key(s) still use ON DELETE CASCADE',
    'partner/API evidence foreign key(s) still use ON DELETE CASCADE',
    'v_auth_cascades',
    'v_partner_cascades',
    'reserve/outbox tables expose',
    'wallet_reservations_amount_positive',
    'wallet_reservations_terminal_timestamp',
    'fulfillment_dispatch_claim_consistency',
    'idx_wallet_reservations_idempotency_key_unique',
    'idx_fulfillment_dispatch_outbox_idempotency_unique',
    'financial authorization order-table column(s) missing',
    'financial authorization status constraint(s) missing',
    'financial authorization index(es) missing',
    'wallet_reservation_id',
    'fulfillment_outbox_id',
    'financial_authorization_status',
    'financial_security_version',
    'profiles_financial_security_version_positive',
    'financial_authorization_reference',
    "has_table_privilege(role_name, 'public.' || table_name, privilege_name)",
    "has_table_privilege('service_role', 'public.' || table_name, privilege_name)",
    'reserve/outbox RPCs expose',
    'changed_payload_must_conflict',
    "has_function_privilege(role_name, function_signature, 'EXECUTE')",
    "has_function_privilege('service_role', function_signature, 'EXECUTE')",
    'public.enqueue_fulfillment_dispatch(text, text, uuid, uuid, uuid, text, jsonb, integer)',
    'public.claim_fulfillment_dispatch(text, text, integer)',
    'public.finish_fulfillment_dispatch(uuid, text, text, text)',
    'public.create_wallet_reservation(uuid, numeric, text, uuid, text, jsonb, text, integer, timestamptz)',
    'public.capture_wallet_reservation(uuid, text, text, text, jsonb, uuid)',
    'public.release_wallet_reservation(uuid, text, text)',
    'public.authorize_product_purchase(uuid, uuid, integer, numeric, text, jsonb, uuid, integer)',
    'public.complete_product_purchase(uuid, uuid, uuid, uuid[], jsonb, text, text, text, uuid)',
    'FULFILLMENT_RESERVATION_REQUIRED',
    'fulfillment_dispatch_security_version_stale',
    'WALLET_SECURITY_VERSION_STALE',
    'COALESCE(v_profile.financial_security_version, 1)',
    'wallet-db-security-test:reservation-rpc:hold',
    'wallet-db-security-test:reservation-rpc:capture',
    'wallet-db-security-test:reservation-rpc:release',
    'active hold did not reduce trusted available funds',
    'reservation capture did not create exactly one wallet-engine purchase row',
    'reservation release created refund/credit transaction rows',
    "array_to_string(roles, ',') ~ '(^|,)(anon|authenticated|public)(,|$)'",
    'wallet-db-security-test:referral-withdrawal',
    'Purchase backed only by internal/referral movement',
    'wallet-db-security-test:refund-cap:over-refund',
    'wallet-db-security-test:pending-refund:zero-snapshot',
    'wallet-db-security-test:unbacked-legacy-refund:attempted-purchase',
    'wallet-db-security-test:chargeback:debt',
    'request.jwt.claim.sub',
    'expected_trusted_backing',
    "v_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS'",
    'ROLLBACK',
  ]) {
    assert(src.includes(needle), `DB security test pack missing ${needle}`)
  }
})

check('staging DB security runner is guarded and owner-controlled', () => {
  const script = read('scripts/wallet-db-security-runner.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:db-pack": "node scripts/wallet-db-security-runner.mjs"'), 'package script must expose DB security runner')
  for (const needle of [
    'TALLYSTORE_DB_TEST_ENV',
    'This runner refuses production',
    'I_UNDERSTAND_ROLLBACK_TEST_MUTATIONS',
    '--test-user-id <ordinary-customer-uuid>',
    '--test-admin-id <admin-profile-uuid>',
    'TALLYSTORE_DB_TEST_ADMIN_ID',
    'SUPABASE_DB_URL',
    'DATABASE_URL',
    '--self-test',
    'runSelfTest',
    'noDatabaseConnection',
    'injectFixtureIds',
    'psql',
    'TALLYSTORE_DB_TEST_TIMEOUT_MS',
    'psql timed out after',
    'timedOut',
    'timeoutMs',
    'Requires an owner-controlled database role',
    'temporarily',
    'disable one trigger inside the rollback transaction',
    'ROLLBACK;',
    'wallet-db-security-test-pack passed inside rollback transaction',
    'DB security SQL pack must test browser-role protected profile writes',
    'DB security SQL pack must test fake provider evidence rejection',
    'DB security SQL pack must test refunds without original debit links',
    'DB security SQL pack must test forged trusted-marker refund rejection',
    'DB security SQL pack must test chargeback debt preservation',
    'ADMIN_CREDIT_APPROVAL_EVIDENCE_REQUIRED',
    'approved admin credit with explicit approval metadata',
    'DB security SQL pack must test partner API pause or partner table authority',
    '00000000-0000-0000-0000-000000000000',
    '[DATABASE_URL_REDACTED]',
  ]) {
    assert(script.includes(needle), `DB security runner missing ${needle}`)
  }
  const localSuite = read('scripts/wallet-local-security-suite.mjs')
  assert(localSuite.includes("['node', ['scripts/wallet-db-security-runner.mjs', '--self-test']"), 'local suite must run DB security runner self-test without connecting to a database')
})

check('deployed smoke test only exercises denied incident routes', () => {
  const script = read('scripts/wallet-deployed-smoke-test.mjs')
  const example = read('docs/security/wallet-deployed-denied-probes.example.json')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:deployed-smoke": "node scripts/wallet-deployed-smoke-test.mjs"'), 'package script must expose deployed smoke test')
  for (const needle of [
    'TALLYSTORE_DEPLOYED_SMOKE_ENV',
    'I_UNDERSTAND_NO_ORDER_CREATION',
    '--allow-production',
    'PARTNER_API_PAUSED',
    '/api/webhook-ercas',
    '/api/webhook/ercas',
    '/api/webhook-pocketfi',
    '/api/webhook-istar',
    'TALLYSTORE_SUPABASE_FUNCTIONS_BASE_URL',
    'TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION',
    'TALLYSTORE_DEPLOYED_SMOKE_CRON_SECRET',
    'TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES',
    'TALLYSTORE_DEPLOYED_SMOKE_OWNER_DENIED_PROBES_ACK',
    'I_UNDERSTAND_TEST_ACCOUNTS_MUST_BE_DENIED',
    '--functions-base-url',
    '--authorization',
    '--cron-secret',
    '--owner-denied-probes',
    '--validate-owner-denied-probes',
    '--timeout-ms',
    '--self-test',
    'TALLYSTORE_DEPLOYED_SMOKE_TIMEOUT_MS',
    'requestTimeoutMs',
    'AbortSignal.timeout(requestTimeoutMs)',
    'expectedPausedCode',
    'requiresCronSecret',
    'BILLS_PAUSED',
    'BITREFILL_PAUSED',
    'WITHDRAWALS_PAUSED',
    'CRYPTO_TOPUP_PAUSED',
    'SMM_ORDERS_PAUSED',
    'SMS_OTP_PAUSED',
    'TELEGRAM_ORDERS_PAUSED',
    'REFERRAL_WITHDRAWALS_PAUSED',
    'MANUAL_RESTOCK_PAUSED',
    'AUTO_RESTOCK_PAUSED',
    'LIVE_ACCOUNT_FULFILLMENT_PAUSED',
    'edgeAuthorizationProvided',
    'cronSecretProvided',
    'ownerDeniedProbesLoaded',
    'purchase-bills',
    'purchase-bitrefill',
    'create-withdrawal-request',
    'create-crypto-sell-order',
    'smm-create-order',
    'smsbus',
    'telegram-stars',
    'withdraw-referral-balance',
    'manual-restock',
    'auto-restock',
    'muabanvia-fulfill',
    'edgeFunctionDeniedTest',
    'buildEdgeDeniedProbeBody',
    'edgeFunctionMalformedTest',
    'loadOwnerDeniedProbeTests',
    'readOwnerDeniedProbeConfig',
    'validateOwnerDeniedProbesFile',
    'normalizeOwnerDeniedProbeFunctionName',
    'normalizeOwnerDeniedProbeMethod',
    'normalizeOwnerDeniedProbePayload',
    'validateOwnerProbePayloadSafety',
    'normalizeOwnerDeniedProbeExpectedStatuses',
    'compileOwnerDeniedProbePattern',
    'sanitizeOwnerProbeHeaders',
    'runSelfTest',
    'noNetworkRequests',
    'mode: \'validate-owner-denied-probes\'',
    'POST-only methods',
    'expected denial regex patterns',
    'secret-looking payload values and protected smoke marker',
    'must not override protected header',
    'owner probe smoke override',
    'built-in deployed probe request body must contain the runner-controlled smoke marker',
    'built-in deployed probe should preserve route-specific idempotency keys',
    'must not set ${fieldPath}',
    'runner-controlled smoke marker',
    'payload field ${fieldPath} looks like a secret',
    'looks like a secret. Keep secrets in environment variables',
    'x-tally-smoke-test',
    'authorization',
    'x-cron-secret',
    'owner-denied-no-value-delivery',
    'body?.success !== true',
    'process-purchase',
    'smoke-invalid-product',
    'smoke-paused-smm',
    'smoke-paused-sms',
    'smoke-paused-telegram',
    'verification header',
    'invalid webhook signature',
    'Optionally checks paused paid Edge Functions reject unauthenticated no-order probes',
    'With TALLYSTORE_DEPLOYED_SMOKE_AUTHORIZATION, verifies exact *_PAUSED codes',
    'must fail validation before order creation, wallet debit, provider dispatch, or value',
    'owner-controlled denied checkout probes',
    'requires body.success !== true',
    'With TALLYSTORE_DEPLOYED_SMOKE_CRON_SECRET, verifies the auto-restock exact pause code',
    'Does not create orders, top-ups, supplier requests, or wallet credits',
    'Do not reopen a paused paid route solely because this smoke test passes',
  ]) {
    assert(script.includes(needle), `deployed smoke test missing ${needle}`)
  }
  const malformedProbeStart = script.indexOf('function edgeFunctionMalformedTest')
  const malformedProbeEnd = script.indexOf('function loadOwnerDeniedProbeTests')
  assert(malformedProbeStart > -1 && malformedProbeEnd > malformedProbeStart, 'deployed smoke test must contain a bounded malformed probe function block')
  const malformedProbeBlock = script.slice(malformedProbeStart, malformedProbeEnd)
  assert(malformedProbeBlock.includes('body: buildEdgeDeniedProbeBody(payload, functionName)'), 'malformed deployed checkout probes must use the protected smoke-body builder')
  const localSuite = read('scripts/wallet-local-security-suite.mjs')
  assert(localSuite.includes("['node', ['scripts/wallet-deployed-smoke-test.mjs', '--self-test']"), 'local suite must run deployed smoke self-test without contacting deployed routes')
  assert(localSuite.includes("['node', ['scripts/wallet-deployed-smoke-test.mjs', '--validate-owner-denied-probes', 'docs/security/wallet-deployed-denied-probes.example.json']"), 'local suite must validate owner denied probes without contacting deployed routes')

  for (const needle of [
    'zero balance product purchase declines without freeze',
    'low balance product purchase declines without supplier dispatch',
    'frozen customer cannot purchase with old token',
    'frozen customer cannot use SMM checkout',
    'frozen customer cannot use SMS checkout',
    'frozen customer cannot use Telegram checkout',
    'frozen customer cannot use bills checkout',
    'frozen customer cannot use Bitrefill checkout',
    'frozen customer cannot use withdrawal route',
    'stale client balance cannot authorize checkout',
    'OWNER_STAGING_PRODUCT_ID',
    'OWNER_STAGING_SMM_SERVICE_ID',
    'OWNER_STAGING_SMS_SERVICE_ID',
    'OWNER_STAGING_BITREFILL_PRODUCT_ID',
    'OWNER_STAGING_BITREFILL_PACKAGE_ID',
    'OWNER_STAGING_BANK_CODE',
    'INSUFFICIENT_FUNDS',
    'WALLET_NOT_ACTIVE',
    'BILLS_PAUSED',
    'BITREFILL_PAUSED',
    'WITHDRAWALS_PAUSED',
    'client_reported_balance',
  ]) {
    assert(example.includes(needle), `deployed denied probes example missing ${needle}`)
  }
})

check('deployed version evidence template gates old build verification', () => {
  const script = read('scripts/wallet-deployed-version-evidence.mjs')
  const pkg = read('package.json')
  const localSuite = read('scripts/wallet-local-security-suite.mjs')
  const checklist = read('docs/security/wallet-owner-verification-checklist.md')
  const evidenceRegister = read('docs/security/wallet-production-evidence-register.md')
  const matrix = read('docs/security/wallet-regression-matrix.md')
  const testReport = read('docs/security/wallet-test-report.md')

  assert(pkg.includes('"security:wallet:deployed-versions": "node scripts/wallet-deployed-version-evidence.mjs"'), 'package script must expose deployed-version evidence tooling')
  for (const command of [
    'scripts/wallet-deployed-version-evidence.mjs',
    '--format',
    '--filled-template',
    '--self-test',
  ]) {
    assert(localSuite.includes(command), `local suite must run deployed-version evidence command ${command}`)
  }

  for (const needle of [
    'sourceSummary',
    'fingerprint',
    'discoverFunctions',
    'supabase/functions',
    'supabase_migrations',
    'pause_flags',
    'SURFACE_NOT_PASSED',
    'EXPECTED_FINGERPRINT_CHANGED',
    'FINGERPRINT_MISMATCH',
    'DUPLICATE_SURFACE',
    'INVALID_VERIFIED_AT',
    'DIRTY_SOURCE_APPROVAL_REQUIRED',
    'INVALID_DIRTY_SOURCE_APPROVAL_AT',
    'SOURCE_DIRTY_STATE_CHANGED',
    'validateSurfaceProofEvidence',
    'REQUIRED_PROOF_MISSING',
    'PROOF_NOT_PASSED',
    'PASSED_SURFACE_HAS_UNPASSED_PROOF',
    'PROOF_REFERENCE_MISSING',
    'UNKNOWN_PROOF',
    'DUPLICATE_PROOF',
    'MISSING_SURFACE',
    'SECRET_LIKE_VALUE',
    'dirtyArtifactApprovedBy',
    'dirtyArtifactApprovedAt',
    'dirtyArtifactEvidencePathOrLink',
    'dirtyArtifactReviewNote',
    'Pending or missing proof keeps routes paused',
    'It does not contact Vercel or Supabase',
    '20260919027000_harden_financial_security_version.sql',
  ]) {
    assert(script.includes(needle), `deployed-version evidence script missing ${needle}`)
  }

  assert(checklist.includes('security:wallet:deployed-versions'), 'owner checklist must include deployed-version evidence tooling')
  assert(checklist.includes('source.dirtyArtifactApprovedBy'), 'owner checklist must require dirty source artifact approval fields')
  assert(checklist.includes('evidence[].proof'), 'owner checklist must require per-proof deployed-version evidence rows')
  assert(checklist.includes('per-surface required proof rows'), 'owner checklist must explain per-surface deployed-version proof rows')
  assert(evidenceRegister.includes('Deployed version evidence file'), 'production evidence register must track deployed-version evidence')
  assert(evidenceRegister.includes('Dirty source artifact approval'), 'production evidence register must track dirty source artifact approval')
  assert(evidenceRegister.includes('source.dirtyArtifactEvidencePathOrLink'), 'production evidence register must require dirty artifact evidence links')
  assert(evidenceRegister.includes('evidence[].proof'), 'production evidence register must require generated deployed-version proof rows')
  assert(evidenceRegister.includes('missing proof references'), 'production evidence register must fail missing deployed-version proof references')
  assert(evidenceRegister.includes('unknown proof rows'), 'production evidence register must fail unknown deployed-version proof rows')
  assert(matrix.includes('LOCAL_DEPLOYED_VERSION_EVIDENCE_PASSED'), 'regression matrix must record local deployed-version evidence coverage')
  assert(testReport.includes('deployed-version self-test covers 40 deployment surfaces'), 'test report must document deployed-version evidence surface count')
  assert(testReport.includes('per-surface required proof rows'), 'test report must document deployed-version per-proof validation')
  assert(testReport.includes('dirty source without artifact approval'), 'test report must document dirty source deployed-version denial')
})

check('staging DB security test pack covers refund conservation edge cases', () => {
  const src = read('docs/security/wallet-db-security-test-pack.sql')
  for (const needle of [
    'REFUND_ORIGINAL_DEBIT_REQUIRED',
    'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT',
    'refund without original debit link was not rejected',
    'over-refund was not rejected at the wallet engine',
    'Over-refund excess must not authorize extra spend',
    'Seeded completed refund without original debit must not restore trusted backing',
    'Completed loose refund row must not authorize spend',
    'Pending refund row must not authorize spend',
    'Refund of unbacked legacy purchase must not authorize spend',
    'Seeded unbacked legacy purchase with forged trusted-principal metadata',
    'Forged trusted-principal metadata must not authorize spend',
    'Refund against forged trusted-principal metadata must be rejected',
    'Deposit-looking row with fake provider identity must not create trusted principal',
    'PAYMENT_VERIFICATION_EVIDENCE_REQUIRED',
    'wallet-db-security-test:deposit-with-fake-provider-evidence',
    'wallet-db-security-test:fake-trusted-metadata:attempted-purchase',
    'wallet-db-security-test:fake-trusted-refund-source:refund-attempt',
    "'source_debit_idempotency_key', 'wallet-db-security-test:refund-cap:purchase'",
    'ALTER TABLE public.transactions DISABLE TRIGGER guard_trusted_principal_transaction_insert',
    'ALTER TABLE public.transactions ENABLE TRIGGER guard_trusted_principal_transaction_insert',
    "v_missing_original_refund->>'code' IS DISTINCT FROM 'REFUND_ORIGINAL_DEBIT_REQUIRED'",
    "v_over_refund->>'code' IS DISTINCT FROM 'REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT'",
    "v_extra_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS'",
    "v_loose_refund_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS'",
    "v_pending_refund_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS'",
    "v_legacy_refund_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS'",
    "v_fake_metadata_purchase->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS'",
    "v_fake_metadata_refund->>'code' IS DISTINCT FROM 'REFUND_ORIGINAL_DEBIT_NOT_TRUSTED'",
  ]) {
    assert(src.includes(needle), `DB security refund edge-case coverage missing ${needle}`)
  }
  assertOrder(
    src,
    'ALTER TABLE public.transactions DISABLE TRIGGER guard_trusted_principal_transaction_insert',
    'wallet-db-security-test:loose-refund:completed',
    'loose-refund legacy seed must disable trusted-principal guard before inserting malformed history',
  )
  assertOrder(
    src,
    'wallet-db-security-test:loose-refund:completed',
    'ALTER TABLE public.transactions ENABLE TRIGGER guard_trusted_principal_transaction_insert',
    'loose-refund legacy seed must re-enable trusted-principal guard after insertion',
  )
  assertOrder(
    src,
    'ALTER TABLE public.transactions ENABLE TRIGGER guard_trusted_principal_transaction_insert',
    'wallet-db-security-test:loose-refund:purchase',
    'loose-refund purchase proof must run after the trusted-principal guard is re-enabled',
  )
  assertOrder(
    src,
    'wallet-db-security-test:fake-trusted-metadata:refund',
    'wallet-db-security-test:fake-trusted-metadata:attempted-purchase',
    'forged trusted metadata proof must run after the malformed legacy rows are seeded',
  )
  assertOrder(
    src,
    'wallet-db-security-test:fake-trusted-refund-source:purchase',
    'wallet-db-security-test:fake-trusted-refund-source:refund-attempt',
    'forged trusted metadata refund proof must run after the malformed original debit is seeded',
  )
})

check('staging DB security test pack covers chargeback debt handling', () => {
  const src = read('docs/security/wallet-db-security-test-pack.sql')
  for (const needle of [
    'Chargeback debt must be recorded and frozen',
    "v_chargeback->>'balance_after'",
    'Wallet frozen: chargeback posted a debt balance',
    'chargeback debt did not freeze wallet with debt preserved',
  ]) {
    assert(src.includes(needle), `DB security chargeback coverage missing ${needle}`)
  }
})

check('admin user detail dates show absolute and relative timestamps', () => {
  const src = read('src/pages/AdminPage.tsx')
  for (const needle of [
    'function formatAdminAbsoluteDateTime',
    'function formatAdminDateWithRelative',
    'ADMIN_TIME_ZONE',
    'Suspended {formatAdminDateWithRelative(selectedUser.suspended_at)}',
    '<p>{formatAdminDateWithRelative(selectedUser?.created_at)}</p>',
    'Last seen {formatAdminDateWithRelative(selectedUser.fraud_last_ip_seen_at)}',
    'Suspended {formatAdminDateWithRelative(row.suspendedAt)}',
    'Seen {formatAdminDateWithRelative(row.lastIpSeenAt)}',
  ]) {
    assert(src.includes(needle), `admin date display guard missing ${needle}`)
  }
})

check('admin transaction display treats debit types as negative', () => {
  const adminPage = read('src/pages/AdminPage.tsx')
  const migration = read('supabase/migrations/20260919014000_normalize_debit_transaction_signs.sql')

  for (const needle of [
    'function getWalletTransactionDisplayAmount',
    "'admin_debit'",
    "'staff_debit'",
    "'chargeback'",
    'if (isWalletSpendTransaction(tx)) return -absoluteAmount',
    'const signedAmount = getWalletTransactionDisplayAmount(tx)',
    'const isCredit = signedAmount > 0',
    'const isSpend = signedAmount < 0',
  ]) {
    assert(adminPage.includes(needle), `admin transaction display guard missing ${needle}`)
  }

  assert(migration.includes('UPDATE public.transactions'), 'debit sign cleanup migration must update transactions')
  assert(migration.includes('amount = -abs(amount)'), 'debit sign cleanup migration must force negative debit amounts')
  assert(migration.includes("'admin_debit'"), 'debit sign cleanup migration must cover admin_debit')
  assert(migration.includes('sign_normalized_from_amount'), 'debit sign cleanup migration must preserve original amount evidence')
})

check('customer transaction display treats typed debits as negative', () => {
  const walletPage = read('src/pages/WalletPage.tsx')
  const dashboard = read('src/pages/Dashboard.tsx')
  const helper = read('src/lib/walletTransactions.ts')

  for (const needle of [
    'export const debitTransactionTypes = new Set',
    "'admin_debit'",
    "'staff_debit'",
    "'chargeback'",
    'export const depositTransactionTypes = new Set',
    'export const refundTransactionTypes = new Set',
    "'auto_refund'",
    'export const getTransactionSignedAmount',
    'if (debitTransactionTypes.has(type)) return -absoluteAmount',
    'if (creditTransactionTypes.has(type)) return absoluteAmount',
    "if (refundTransactionTypes.has(type)) return 'restoration'",
    "if (isDepositTransactionType(type)) return 'Wallet top-up'",
    "if (type === 'admin_credit') return 'Admin credit'",
    "if (type === 'staff_credit') return 'Staff credit'",
    "if (type === 'promotion_credit') return 'Promotion credit'",
    "if (type === 'correction_credit') return 'Correction credit'",
    "if (type === 'referral_withdrawal') return 'Referral transfer'",
    "if (kind === 'restoration') return 'Refund restoration'",
  ]) {
    assert(helper.includes(needle), `shared wallet transaction helper missing ${needle}`)
  }

  assert(walletPage.includes("from '@/lib/walletTransactions'"), 'wallet page must use the shared wallet transaction helper')
  assert(dashboard.includes("from '@/lib/walletTransactions'"), 'dashboard must use the shared wallet transaction helper')
  assert(walletPage.includes('isDepositTransactionType(transaction.type)'), 'wallet page total deposits must use deposit/topup transaction types only')
  assert(walletPage.includes('classifyWalletTransaction(transaction)'), 'wallet page must classify rows through the shared helper')
  assert(walletPage.includes("['restoration', 'Refunds']"), 'wallet page must expose a refund/restoration tab instead of mixing refunds into funding')
  assert(dashboard.includes('getWalletTransactionTitle(transaction)'), 'dashboard must label recent activity through the shared helper')
  assert(!dashboard.includes("title: isRefund ? 'Refund restoration'"), 'dashboard must not keep a separate positive-credit title branch')
  assert(!dashboard.includes("transaction.type === 'topup' || Number(transaction.amount) > 0"), 'dashboard must not classify credits by positive amount alone')
  assert(!walletPage.includes("Number(transaction.amount) < 0) return 'purchase'"), 'wallet page must not classify purchases by raw negative amount alone')
})

check('profile privileged fields are guarded', () => {
  const src = read('supabase/migrations/20260919003000_guard_profile_privileged_fields.sql')
  const restricted = read('supabase/migrations/20260919016000_restrict_profile_privileged_writes.sql')
  const walletEngine = read('supabase/migrations/202609170060_create_wallet_transaction_engine.sql')
  const backedWalletEngine = read('supabase/migrations/20260919001000_enforce_backed_wallet_purchases.sql')
  const balanceAuthority = read('supabase/migrations/202609170050_enforce_profile_balance_authority.sql')
  for (const field of [
    'is_admin',
    'is_staff',
    'account_suspended',
    'wallet_balance',
    'crypto_balance',
    'referral_balance',
    'pocketfi_account_number',
    'suspended_by',
    'suspension_reinstated_at',
    'reinstated_by',
  ]) {
    assert(
      src.includes(`NEW.${field} := OLD.${field}`) ||
        src.includes(`NEW.${field} := false`) ||
        src.includes(`NEW.${field} := NULL`) ||
        restricted.includes(`NEW.${field} := OLD.${field}`) ||
        restricted.includes(`NEW.${field} := false`) ||
        restricted.includes(`NEW.${field} := NULL`),
      `missing guard for ${field}`,
    )
  }
  assert(!/request_role\s*=\s*'service_role'\s+OR/.test(restricted), 'service_role alone must not bypass profile privileged-field guard')
  for (const fn of [
    'set_customer_pocketfi_account',
    'apply_profile_referral_attribution',
    'set_customer_suspension_state',
    'set_staff_role',
  ]) {
    assert(restricted.includes(`FUNCTION public.${fn}`), `missing narrow privileged profile writer ${fn}`)
  }
  assert(walletEngine.includes("current_setting('app.tally_wallet_engine_authorized', true) = 'true'"), 'profile balance guard must require the wallet-engine authorization flag')
  assert(walletEngine.includes('Blocked direct service-role balance edit. Use apply_wallet_transaction().'), 'profile balance guard must block direct service-role balance edits')
  assert(
    backedWalletEngine.includes(
      "PERFORM set_config('app.tally_wallet_engine_authorized', 'true', true);\n  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);",
    ),
    'latest wallet engine must authorize guarded profile balance/freeze updates',
  )
  assert(
    backedWalletEngine.includes(
      "PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);\n  PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);",
    ),
    'latest wallet engine must clear guarded profile update authorization',
  )
  assert(balanceAuthority.includes('CREATE TRIGGER guard_profile_balance_update'), 'profile balance-authority update trigger must exist')
  assert(src.includes('CREATE TRIGGER guard_profile_privileged_fields_update'), 'profile privileged-field update trigger must exist')
})

check('server protected profile writes use narrow RPCs', () => {
  const protectedFields = [
    'wallet_balance',
    'crypto_balance',
    'referral_balance',
    'is_admin',
    'is_staff',
    'account_suspended',
    'suspension_reason',
    'suspended_at',
    'suspended_by',
    'suspension_reinstated_at',
    'reinstated_by',
    'pocketfi_account_number',
    'pocketfi_account_name',
    'pocketfi_bank',
    'referred_by',
    'referral_code',
  ]
  const protectedPattern = new RegExp(`\\b(${protectedFields.join('|')})\\b`)
  const serverFiles = walk('supabase/functions').filter((path) => /index\.ts$/.test(path))
  const offenders = []

  for (const path of serverFiles) {
    const src = read(path)
    const profileMutationPattern = /\.from\(['"]profiles['"]\)\s*\r?\n\s*\.(insert|update|upsert)\s*\([\s\S]{0,900}?\)/g
    for (const match of src.matchAll(profileMutationPattern)) {
      if (protectedPattern.test(match[0])) offenders.push(`${path}:${match.index}`)
    }
  }

  assert(offenders.length === 0, `server profile mutation includes protected fields outside narrow RPCs: ${offenders.join(', ')}`)

  assert(read('supabase/functions/create-pocketfi-topup/index.ts').includes("rpc('set_customer_pocketfi_account'"), 'PocketFi account metadata must use the narrow RPC')
  assert(read('supabase/functions/apply-referral/index.ts').includes("rpc('apply_profile_referral_attribution'"), 'referral attribution must use the narrow RPC')
  assert(read('supabase/functions/admin-adjust-balance/index.ts').includes("rpc('set_customer_suspension_state'"), 'suspension changes must use the narrow RPC')
  assert(read('supabase/functions/manage-staff/index.ts').includes("rpc('set_staff_role'"), 'staff role changes must use the narrow RPC')
})

check('browser profile writes and signup metadata cannot mass-assign protected fields', () => {
  const protectedFields = [
    'wallet_balance',
    'crypto_balance',
    'referral_balance',
    'is_admin',
    'is_staff',
    'account_suspended',
    'suspension_reason',
    'suspended_at',
    'pocketfi_account_number',
    'pocketfi_account_name',
    'pocketfi_bank',
    'referred_by',
    'referral_code',
  ]
  const protectedPattern = new RegExp(`\\b(${protectedFields.join('|')})\\b`)
  const clientFiles = walk('src').filter((path) => /\.(ts|tsx|js|jsx)$/.test(path))
  const profileMutationOffenders = []
  const signupMetadataOffenders = []

  for (const path of clientFiles) {
    const src = read(path)
    const profileMutationPattern = /\.from\(['"]profiles['"]\)[\s\S]{0,700}\.(insert|update|upsert)\s*\(([\s\S]{0,700})\)/g
    for (const match of src.matchAll(profileMutationPattern)) {
      if (protectedPattern.test(match[0])) profileMutationOffenders.push(path)
    }

    let start = src.indexOf('auth.signUp')
    while (start !== -1) {
      const segment = src.slice(start, start + 1200)
      if (protectedPattern.test(segment)) signupMetadataOffenders.push(path)
      start = src.indexOf('auth.signUp', start + 1)
    }
  }

  assert(profileMutationOffenders.length === 0, `browser profile mutation includes protected fields: ${[...new Set(profileMutationOffenders)].join(', ')}`)
  assert(signupMetadataOffenders.length === 0, `signup metadata includes protected fields: ${[...new Set(signupMetadataOffenders)].join(', ')}`)
})

check('referral attribution and withdrawal authority are server-controlled', () => {
  const applyReferral = read('supabase/functions/apply-referral/index.ts')
  const applyReferralConfig = read('supabase/functions/apply-referral/config.toml')
  const withdrawReferral = read('supabase/functions/withdraw-referral-balance/index.ts')
  const referralsPage = read('src/pages/ReferralsPage.tsx')
  const referralWithdrawalPage = read('src/pages/ReferralWithdrawal.tsx')

  assert(applyReferralConfig.includes('verify_jwt = true'), 'apply-referral must require authenticated JWTs')
  assert(applyReferral.includes('const userId = user.id'), 'apply-referral must derive the target user from the authenticated session')
  assert(!applyReferral.includes('body.user_id') && !applyReferral.includes('body.userId'), 'apply-referral must ignore caller-provided user ids')
  assert(applyReferral.includes("rpc('apply_profile_referral_attribution'"), 'apply-referral must use the narrow database referral writer')

  const referralRpc = read('supabase/migrations/20260919016000_restrict_profile_privileged_writes.sql')
  assert(referralRpc.includes('clean_code <> own_code'), 'referral writer must block self-referral')
  assert(referralRpc.includes('target_profile.referred_by IS NULL'), 'referral writer must not overwrite existing referral attribution')
  assert(referralRpc.includes('WHERE referral_code = clean_code'), 'referral writer must only set referred_by after a referral code lookup')

  assert(withdrawReferral.includes("code: 'REFERRAL_WITHDRAWALS_PAUSED'"), 'referral withdrawals must remain hard-paused during incident review')
  assert(!withdrawReferral.includes('REFERRAL_WITHDRAWALS_ENABLED'), 'referral withdrawals must not be re-openable by environment flag during incident review')
  assert(!withdrawReferral.includes('withdraw_referral_balance_to_wallet'), 'referral withdrawals must not call the legacy referral-to-wallet RPC while paused')
  assert(!/\.from\(['"]profiles['"]\)[^;]{0,500}\.update\s*\([^;]*(wallet_balance|referral_balance)/.test(withdrawReferral), 'referral withdrawals must not update profile balances directly')
  assert(!referralsPage.includes('withdrawReferralBalance'), 'referrals page must not call the paused referral-to-wallet client helper')
  assert(referralsPage.includes('Wallet Move Paused'), 'referrals page must show referral wallet movement as paused')
  assert(referralsPage.includes('wallet security review'), 'referrals page must explain referral movement is paused for wallet security review')
  assert(referralWithdrawalPage.includes('wallet security review'), 'referral withdrawal page must explain referral movement is paused for wallet security review')
  assert(!referralWithdrawalPage.includes('move your referral balance directly to your Naira wallet'), 'referral withdrawal page must not invite referral balance movement into wallet')
})

check('new profiles start with zero balances', () => {
  const src = read('supabase/migrations/202609170050_enforce_profile_balance_authority.sql')
  assert(src.includes('ALTER COLUMN wallet_balance SET DEFAULT 0'), 'wallet_balance default must be zero')
  assert(src.includes('NEW.wallet_balance := 0'), 'insert trigger must force wallet balance zero')
  assert(src.includes('NEW.crypto_balance := 0'), 'insert trigger must force crypto balance zero')
  assert(src.includes('NEW.referral_balance := 0'), 'insert trigger must force referral balance zero')
})

check('referral lookup migration casts uuid/text safely', () => {
  const src = read('supabase/migrations/20260914007000_fix_security_definer_public_views.sql')
  const repair = read('supabase/migrations/20260919006000_fix_referral_lookup_casts.sql')
  assert(src.includes('with (security_invoker = true)'), 'individual_accounts_public must be security invoker')
  assert(src.includes('referred_by::text'), 'original referral migration must cast referred_by')
  assert(repair.includes('alter column referred_by type text using referred_by::text'), 'repair migration must normalize referred_by to text')
})

check('Ercas crediting is bound to server-created pending payments', () => {
  const src = read('supabase/functions/verify-and-credit-wallet/index.ts')
  assert(src.includes(".from('pending_payments')"), 'verification must look up pending_payments')
  assert(src.includes('.eq(\'transaction_reference\', transaction_reference)'), 'verification must bind by transaction reference')
  assert(src.includes('.eq(\'user_id\', userId)'), 'verification must bind by user id')
  assert(src.includes(".eq('id', pendingPayment.id)"), 'successful verification must consume the exact pending payment row')
  assert(src.includes('amount: verifiedAmount'), 'wallet credit must use verified numeric amount')
})

check('browser payment success pages cannot create wallet credit', () => {
  const callback = read('src/pages/PaymentCallbackPage.tsx')
  const success = read('src/pages/PaymentSuccessPage.tsx')
  const browserApi = read('src/lib/supabase.ts')
  const topup = read('supabase/functions/create-wallet-topup/index.ts')
  const verifier = read('supabase/functions/verify-and-credit-wallet/index.ts')

  for (const [label, src] of [['callback', callback], ['success', success]]) {
    assert(src.includes('verifyAndCreditWalletSecure'), `${label} page must call the secure server verifier`)
    assert(!/\.from\(['"]transactions['"]\)[\s\S]{0,500}\.insert\s*\(/.test(src), `${label} page must not insert wallet ledger rows`)
    assert(!/\.from\(['"]profiles['"]\)[\s\S]{0,500}\.update\s*\([\s\S]{0,500}wallet_balance/.test(src), `${label} page must not update profile wallet balance`)
    assert(!src.includes('updateUserWalletBalance'), `${label} page must not call legacy client-side wallet credit`)
  }

  assert(browserApi.includes('Legacy client-side wallet credit is disabled. Use verifyAndCreditWalletSecure().'), 'legacy client-side wallet credit helper must stay disabled')
  assert(browserApi.includes('Legacy client-side top-up transaction insertion is disabled. Use verifyAndCreditWalletSecure() or provider webhooks.'), 'legacy client-side transaction insert helper must stay disabled')
  const walletBalanceHelper = browserApi.slice(
    browserApi.indexOf('export async function updateUserWalletBalance'),
    browserApi.indexOf('// Get available account for purchase'),
  )
  const topupRecordHelper = browserApi.slice(
    browserApi.indexOf('export async function recordTopUpTransaction'),
    browserApi.indexOf('// Get individual account by ID.'),
  )
  assert(!/\.from\(['"]profiles['"]\)[\s\S]*?\.update\s*\(/.test(walletBalanceHelper), 'legacy wallet-balance helper must not update profiles')
  assert(!/\.from\(['"]transactions['"]\)[\s\S]*?\.insert\s*\(/.test(topupRecordHelper), 'legacy top-up helper must not insert transactions')

  assertOrder(topup, ".from('pending_payments')", 'Could not create trusted payment evidence. Please try again before paying.', 'create-wallet-topup must check pending payment evidence before returning checkout details')
  assertOrder(topup, 'Could not create trusted payment evidence. Please try again before paying.', 'return json({\n      success: true', 'create-wallet-topup must fail closed before returning checkout details')
  assert(topup.includes('Could not create trusted payment evidence. Please try again before paying.'), 'create-wallet-topup must fail closed when pending evidence cannot be created')
  assert(verifier.includes('Payment reference was not created for this account.'), 'verifier must reject callback references not created for the authenticated user')
  assert(verifier.includes('const amount = transaction.amount'), 'verifier must use provider-returned amount as the credited amount')
  assert(verifier.includes('Math.abs(expectedAmount - verifiedAmount) > 0.01'), 'verifier must compare provider amount to server-created pending amount')
  assertOrder(verifier, 'Math.abs(expectedAmount - verifiedAmount) > 0.01', 'const creditResult = await applyWalletTransaction', 'amount mismatch must be rejected before wallet credit')
})

check('Ercas verification timeouts stay pending and never credit provisionally', () => {
  const src = read('supabase/functions/verify-and-credit-wallet/index.ts')
  assert(src.includes('markPendingPaymentVerificationRetry'), 'verify-and-credit must record retry evidence for provider failures')
  assert(src.includes("status: 'pending'"), 'provider verification timeouts must leave pending payment status pending')
  assert(src.includes('check_count: Number(pendingPayment.check_count || 0) + 1'), 'provider verification retries must increment check_count')
  assert(src.includes('last_check_at: new Date().toISOString()'), 'provider verification retries must update last_check_at')
  assert(src.includes("verifyController.abort('ercas_verify_timeout')"), 'Ercas verification must have an explicit timeout')
  assert(src.includes('retryable: true'), 'provider timeout response must be retryable')
  assertOrder(src, 'catch (verificationError)', 'const creditResult = await applyWalletTransaction', 'provider verification failure handling must appear before wallet credit')
  const retryCatch = src.slice(src.indexOf('catch (verificationError)'), src.indexOf('} finally {', src.indexOf('catch (verificationError)')))
  assert(retryCatch.includes('return new Response'), 'provider verification failure must return a retryable response')
  assert(!retryCatch.includes('applyWalletTransaction'), 'provider verification failure must not credit the wallet')
})

check('Ercas definitive provider failures close pending evidence before credit', () => {
  const src = read('supabase/functions/verify-and-credit-wallet/index.ts')
  assert(src.includes('markPendingPaymentVerificationFailed'), 'verify-and-credit must have a definitive failure closer')
  assert(src.includes("status: 'failed'"), 'definitive provider failures must mark pending payments failed')
  assert(src.includes(".eq('status', 'pending')"), 'definitive failure closer must only close currently pending payment rows')
  assert(src.includes('Failed to close failed payment evidence'), 'definitive failure closer must fail closed when DB state cannot be updated')
  for (const marker of [
    'Payment verification failed',
    'Payment status:',
    'Amount mismatch.',
    'Currency mismatch.',
    'Merchant identity mismatch during provider verification.',
    'Payment environment mismatch during provider verification.',
  ]) {
    assert(src.includes(marker), `definitive failure closer must cover ${marker}`)
  }
  assertOrder(src, 'markPendingPaymentVerificationFailed(supabaseAdmin, pendingPayment, errorMsg)', 'const creditResult = await applyWalletTransaction', 'provider failed result must close evidence before wallet credit')
  assertOrder(src, '`Payment status: ${transaction.status}`', 'const creditResult = await applyWalletTransaction', 'provider non-success status must close evidence before wallet credit')
  assertOrder(src, '`Amount mismatch. Expected ${expectedAmount}, got ${verifiedAmount}`', 'const creditResult = await applyWalletTransaction', 'amount mismatch must close evidence before wallet credit')
})

check('provider payment identities cannot fund multiple wallets', () => {
  const migration = read('supabase/migrations/20260919012000_enforce_external_payment_identity.sql')
  assert(migration.includes('idx_transactions_wallet_funding_external_payment_unique'), 'external payment identity must have a wallet-funding uniqueness index')
  assert(migration.includes('ON public.transactions (external_payment_id)'), 'external payment identity uniqueness must be on transactions.external_payment_id')
  assert(migration.includes("COALESCE(balance_type, 'wallet') = 'wallet'"), 'external payment uniqueness must scope to wallet funding')
  assert(migration.includes("'topup'") && migration.includes("'wallet_topup'") && migration.includes("'deposit'"), 'external payment uniqueness must cover wallet funding credit types')

  const walletEngine = read('supabase/migrations/20260919001000_enforce_backed_wallet_purchases.sql')
  assert(walletEngine.includes('external_payment_id,'), 'wallet engine must persist external_payment_id')
  assert(walletEngine.includes('v_external_payment_id'), 'wallet engine must compare/persist provider payment reference')
  assert(walletEngine.includes('IDEMPOTENCY_CONFLICT'), 'wallet engine must reject conflicting idempotent replays')

  const ercas = read('supabase/functions/verify-and-credit-wallet/index.ts')
  assert(ercas.includes('externalPaymentId: ercasRef || transaction_reference'), 'Ercas credits must pass provider payment reference into wallet engine')
  assert(ercas.includes('idempotencyKey: `ercas:${transaction_reference}`'), 'Ercas credits must have deterministic business idempotency')

  const pocketfi = read('supabase/functions/webhook-pocketfi/index.ts')
  assert(pocketfi.includes('externalPaymentId: reference'), 'PocketFi credits must pass provider payment reference into wallet engine')
  assert(pocketfi.includes('idempotencyKey: `pocketfi:${reference}`'), 'PocketFi credits must have deterministic business idempotency')
})

check('Ercas verification rejects provider identity mismatches before credit', () => {
  const src = read('supabase/functions/verify-and-credit-wallet/index.ts')
  assert(src.includes('providerCurrency'), 'Ercas verification must read provider currency when returned')
  assert(src.includes('currency_mismatch'), 'Ercas verification must reject currency mismatch')
  assert(src.includes('ERCASPAY_MERCHANT_ID'), 'Ercas verification must support expected merchant identity env')
  assert(src.includes('merchant_mismatch'), 'Ercas verification must reject configured merchant mismatch')
  assert(src.includes('ERCASPAY_ENVIRONMENT'), 'Ercas verification must support expected environment env')
  assert(src.includes('environment_mismatch'), 'Ercas verification must reject configured environment mismatch')
  assertOrder(src, "error: 'Payment currency did not match the created checkout.'", 'const creditResult = await applyWalletTransaction', 'currency mismatch rejection must happen before wallet credit')
  assertOrder(src, "error: 'Payment merchant did not match TallyStore.'", 'const creditResult = await applyWalletTransaction', 'merchant mismatch rejection must happen before wallet credit')
  assertOrder(src, "error: 'Payment environment did not match TallyStore.'", 'const creditResult = await applyWalletTransaction', 'environment mismatch rejection must happen before wallet credit')
})

check('scheduled pending-payment recovery cannot bypass Ercas verification', () => {
  const src = read('supabase/functions/check-pending-payments/index.ts')

  assert(src.includes('isAuthorizedCron'), 'pending-payment recovery must be cron/service authorized')
  assert(src.includes('PAYMENT_RECOVERY_CRON_SECRET') || src.includes('REVENUE_OS_CRON_SECRET'), 'pending-payment recovery must require a cron secret')
  assert(src.includes('claimPendingPaymentForRecovery'), 'pending-payment recovery must optimistically claim rows before verification')
  assert(src.includes(".eq('status', 'pending')"), 'pending-payment recovery claim must only touch pending rows')
  assert(src.includes("query.eq('check_count', payment.check_count)"), 'pending-payment recovery claim must use check_count compare-and-set')
  assert(src.includes('already claimed by another recovery run'), 'pending-payment recovery must skip rows claimed by another worker')
  assert(src.includes("supabase.functions.invoke('verify-and-credit-wallet'"), 'pending-payment recovery must call the verified credit function')
  assert(src.includes('user_id: payment.user_id'), 'pending-payment recovery must pass the pending payment owner to verification')
  assert(!src.includes('apply_wallet_transaction'), 'pending-payment recovery must not credit wallets directly')
  assert(!/\.from\(['"]profiles['"]\)[\s\S]{0,400}\.update\s*\([\s\S]{0,400}wallet_balance/.test(src), 'pending-payment recovery must not update profile balances directly')
  assert(!/\.from\(['"]transactions['"]\)[\s\S]{0,400}\.insert\s*\(/.test(src), 'pending-payment recovery must not insert wallet ledger rows directly')
})

check('iStar webhook verifies raw body and refunds through wallet engine', () => {
  const src = read('api/webhook-istar.ts')

  assert(src.includes('bodyParser: false'), 'iStar webhook must disable body parsing for HMAC verification')
  assert(src.includes('readRawBody'), 'iStar webhook must read the raw request body')
  assert(src.includes('crypto.createHmac'), 'iStar webhook must verify an HMAC signature')
  assert(src.includes('timingSafeEqual'), 'iStar webhook signature comparison must be timing-safe')
  assert(src.includes('ISTAR_WEBHOOK_SECRET'), 'iStar webhook must require the configured webhook secret')
  assert(src.includes(".rpc('apply_wallet_transaction'"), 'iStar failure refunds must use the wallet engine')
  assert(src.includes("p_idempotency_key: `istar:refund:${order.id}`"), 'iStar refunds must have deterministic idempotency keys')
  assert(!/\.from\(['"]transactions['"]\)[^;]{0,500}\.(insert|update|delete|upsert)\s*\(/.test(src), 'iStar webhook must not directly mutate wallet ledger rows')
})

check('forged payment webhooks cannot punish or credit named customers before verification', () => {
  const pocketfi = read('supabase/functions/webhook-pocketfi/index.ts')
  assertOrder(pocketfi, 'const verified = await verifyPocketFiWebhook(req, rawBody)', 'const payload = rawBody ? JSON.parse(rawBody)', 'PocketFi must verify before parsing or attributing payload')
  assertOrder(pocketfi, 'if (!verified) {', "return json({ error: 'Unauthorized webhook' }, 401)", 'PocketFi invalid signatures must return before payload use')
  assertOrder(pocketfi, "return json({ error: 'Unauthorized webhook' }, 401)", 'const accountNumber = extractAccountNumber(payload)', 'PocketFi must reject before extracting customer account number')
  assert(!pocketfi.includes('account_suspended'), 'PocketFi forged webhook payloads must not suspend a named customer')
  assert(!pocketfi.includes('is_suspended'), 'PocketFi forged webhook payloads must not set suspension flags')

  const istar = read('api/webhook-istar.ts')
  assertOrder(istar, 'if (!verifySignature(rawBody, sig, webhookSecret))', 'const { createClient } = await import', 'iStar must verify signature before creating DB client')
  assertOrder(istar, 'if (!verifySignature(rawBody, sig, webhookSecret))', 'const payload = parsePayload(rawBody, req.body)', 'iStar must verify signature before parsing customer/order payload')
  assert(!istar.includes('account_suspended'), 'iStar forged webhook payloads must not suspend a named customer')
  assert(!istar.includes('is_suspended'), 'iStar forged webhook payloads must not set suspension flags')

  const nowpayments = read('supabase/functions/nowpayments-webhook/index.ts')
  assertOrder(nowpayments, 'if (!signature) {', 'const isValid = await verifyIPNSignature(payload, signature, ipnSecret)', 'NOWPayments must require signature before validation')
  assertOrder(nowpayments, 'if (!isValid) {', 'const supabaseAdmin = createClient', 'NOWPayments must reject invalid signatures before creating admin DB client')
  assertOrder(nowpayments, 'const isValid = await verifyIPNSignature(payload, signature, ipnSecret)', 'const supabaseAdmin = createClient', 'NOWPayments must verify IPN before database mutation access')
  assert(!nowpayments.includes('account_suspended'), 'NOWPayments forged webhook payloads must not suspend a named customer')
  assert(!nowpayments.includes('is_suspended'), 'NOWPayments forged webhook payloads must not set suspension flags')
})

check('JWT-disabled Edge Functions have explicit internal authorization boundaries', () => {
  const jwtDisabledConfigs = walk('supabase/functions')
    .filter((path) => path.endsWith('/config.toml') && contains(path, 'verify_jwt = false'))
    .sort()
  const expectedJwtDisabledConfigs = [
    'supabase/functions/check-pending-payments/config.toml',
    'supabase/functions/nowpayments-webhook/config.toml',
    'supabase/functions/partner-api/config.toml',
    'supabase/functions/record-site-visit/config.toml',
    'supabase/functions/revenue-os-maintenance/config.toml',
    'supabase/functions/smm-check-all-orders/config.toml',
    'supabase/functions/smsbus/config.toml',
    'supabase/functions/webhook-pocketfi/config.toml',
  ].sort()

  assert(
    JSON.stringify(jwtDisabledConfigs) === JSON.stringify(expectedJwtDisabledConfigs),
    `unexpected verify_jwt=false functions: expected ${expectedJwtDisabledConfigs.join(', ')} got ${jwtDisabledConfigs.join(', ')}`,
  )

  const checkPending = read('supabase/functions/check-pending-payments/index.ts')
  assert(contains('supabase/functions/check-pending-payments/config.toml', 'verify_jwt = false'), 'check-pending-payments config must be explicit')
  assert(checkPending.includes('isAuthorizedCron'), 'check-pending-payments must perform its own cron authorization')
  assert(checkPending.includes('PAYMENT_RECOVERY_CRON_SECRET') && checkPending.includes('REVENUE_OS_CRON_SECRET'), 'check-pending-payments must require a configured cron secret')

  const pocketfi = read('supabase/functions/webhook-pocketfi/index.ts')
  assert(contains('supabase/functions/webhook-pocketfi/config.toml', 'verify_jwt = false'), 'webhook-pocketfi config must be explicit')
  assert(pocketfi.includes('verifyPocketFiWebhook'), 'webhook-pocketfi must verify a webhook secret or signature')
  assert(pocketfi.includes('hmacSha512Hex'), 'webhook-pocketfi must support PocketFi HMAC signatures')
  assert(pocketfi.includes('return json({ error: \'Unauthorized webhook\' }, 401)'), 'webhook-pocketfi must reject unauthorized calls')

  const nowpayments = read('supabase/functions/nowpayments-webhook/index.ts')
  assert(contains('supabase/functions/nowpayments-webhook/config.toml', 'verify_jwt = false'), 'nowpayments-webhook config must be explicit')
  assert(nowpayments.includes('NOWPAYMENTS_IPN_SECRET'), 'NOWPayments webhook must require its IPN secret')
  assert(nowpayments.includes('verifyIPNSignature'), 'NOWPayments webhook must verify IPN signatures')

  const partnerApi = read('supabase/functions/partner-api/index.ts')
  assert(contains('supabase/functions/partner-api/config.toml', 'verify_jwt = false'), 'partner-api config must be explicit')
  assert(partnerApi.includes('const PARTNER_API_PAUSED = true'), 'partner-api must remain hard-paused while JWT verification is disabled')
  assert(partnerApi.includes('PARTNER_API_PAUSED && !action.startsWith(\'admin_\')'), 'partner-api must hard-pause non-admin actions')
  assert(partnerApi.includes('async function requireAdmin'), 'partner-api admin actions must perform explicit admin authorization')
  assert(partnerApi.includes('await requireAdmin(req, admin)'), 'partner-api must enforce admin authorization before admin actions')
  assert(partnerApi.includes('async function requirePartner'), 'partner-api must authenticate partner keys even while paused')
  assert(partnerApi.includes('auth = await requirePartner(req, admin)'), 'partner-api must enforce partner authentication before partner actions')

  const smsbus = read('supabase/functions/smsbus/index.ts')
  assert(contains('supabase/functions/smsbus/config.toml', 'verify_jwt = false'), 'smsbus config must be explicit')
  assert(smsbus.includes('verifyDaisyWebhook'), 'smsbus must verify DaisySMS webhook calls')
  assert(smsbus.includes('DAISYSMS_WEBHOOK_SECRET'), 'smsbus webhook path must require DAISYSMS_WEBHOOK_SECRET')
  assert(smsbus.includes('requireAuth'), 'smsbus normal actions must require user authentication')

  const smmAll = read('supabase/functions/smm-check-all-orders/index.ts')
  assert(contains('supabase/functions/smm-check-all-orders/config.toml', 'verify_jwt = false'), 'smm-check-all-orders config must be explicit')
  assert(smmAll.includes('isAuthorizedCron'), 'smm-check-all-orders must perform its own cron authorization')
  assert(smmAll.includes('SMM_CHECK_CRON_SECRET') || smmAll.includes('REVENUE_OS_CRON_SECRET'), 'smm-check-all-orders must require a cron secret')

  const revenueMaintenance = read('supabase/functions/revenue-os-maintenance/index.ts')
  assert(contains('supabase/functions/revenue-os-maintenance/config.toml', 'verify_jwt = false'), 'revenue-os-maintenance config must be explicit')
  assert(revenueMaintenance.includes('requireAuthorized'), 'revenue-os-maintenance must perform its own authorization')
  assert(revenueMaintenance.includes('REVENUE_OS_CRON_SECRET'), 'revenue-os-maintenance must require a cron secret for scheduled calls')

  const recordVisit = read('supabase/functions/record-site-visit/index.ts')
  assert(contains('supabase/functions/record-site-visit/config.toml', 'verify_jwt = false'), 'record-site-visit config must be explicit')
  assert(recordVisit.includes(".from('site_visits')"), 'record-site-visit must be limited to site visit evidence writes')
  assert(!recordVisit.includes(".from('profiles')"), 'record-site-visit must not write profiles')
  assert(!recordVisit.includes(".from('transactions')"), 'record-site-visit must not touch wallet ledger rows')
})

check('paused paid surfaces fail closed by default', () => {
  const expectations = [
    ['supabase/functions/purchase-bills/index.ts', 'BILLS_ENABLED'],
    ['supabase/functions/purchase-bitrefill/index.ts', 'BITREFILL_ENABLED'],
    ['supabase/functions/create-withdrawal-request/index.ts', 'WITHDRAWALS_ENABLED'],
    ['supabase/functions/create-crypto-sell-order/index.ts', 'CRYPTO_TOPUP_ENABLED'],
    ['supabase/functions/smm-create-order/index.ts', 'SMM_ORDERS_ENABLED'],
    ['supabase/functions/smsbus/index.ts', 'SMS_OTP_ENABLED'],
    ['supabase/functions/telegram-stars/index.ts', 'TELEGRAM_ORDERS_ENABLED'],
    ['supabase/functions/muabanvia-fulfill/index.ts', 'LIVE_ACCOUNT_FULFILLMENT_ENABLED'],
    ['supabase/functions/auto-restock/index.ts', 'AUTO_RESTOCK_ENABLED'],
    ['supabase/functions/manual-restock/index.ts', 'MANUAL_RESTOCK_ENABLED'],
  ]
  for (const [path, flag] of expectations) {
    const src = read(path)
    assert(src.includes(flag), `${path} missing ${flag} gate`)
    assert(
      src.includes("!== 'true'") ||
        src.includes("!== \"true\"") ||
        src.includes("=== 'false'") ||
        src.includes("=== \"false\"") ||
        src.includes("=== 'true'") ||
        src.includes("=== \"true\""),
      `${path} should fail closed or explicitly block when disabled`,
    )
  }

  const withdrawal = read('supabase/functions/create-withdrawal-request/index.ts')
  assert(withdrawal.includes("code: 'WITHDRAWALS_PAUSED'"), 'withdrawal pause must return a stable paused code')
  assert(withdrawal.includes('status: 503'), 'withdrawal pause must return a real service-paused status')
  assertOrder(withdrawal, "code: 'WITHDRAWALS_PAUSED'", "req.headers.get('Authorization')", 'withdrawal route must pause before auth/profile work')
  assertOrder(withdrawal, "code: 'WITHDRAWALS_PAUSED'", 'const sageCloudClient = createSageCloudClient', 'withdrawal route must pause before SageCloud setup')
  assertOrder(withdrawal, "code: 'WITHDRAWALS_PAUSED'", ".from('crypto_withdrawals')", 'withdrawal route must pause before local withdrawal row creation')
  assertOrder(withdrawal, "code: 'WITHDRAWALS_PAUSED'", 'transferResponse = await sageCloudClient.transfer', 'withdrawal route must pause before provider transfer')

  const bills = read('supabase/functions/purchase-bills/index.ts')
  assert(bills.includes("code: 'BILLS_PAUSED'"), 'bills pause must return a stable paused code')
  assert(bills.includes('status: 503'), 'bills pause must return a real service-paused status')
  assertOrder(bills, "code: 'BILLS_PAUSED'", "req.headers.get('Authorization')", 'bills route must pause before auth/profile work')
  assertOrder(bills, "code: 'BILLS_PAUSED'", 'const sageCloudClient = createSageCloudClient', 'bills route must pause before SageCloud setup')
  assertOrder(bills, "code: 'BILLS_PAUSED'", ".from('bills_transactions')", 'bills route must pause before local transaction row creation')
  assertOrder(bills, "code: 'BILLS_PAUSED'", 'debitResult = await applyWalletTransaction', 'bills route must pause before wallet debit')
  assertOrder(bills, "code: 'BILLS_PAUSED'", 'purchaseResponse = await sageCloudClient', 'bills route must pause before provider purchase')

  const bitrefill = read('supabase/functions/purchase-bitrefill/index.ts')
  assert(bitrefill.includes("code: 'BITREFILL_PAUSED'"), 'Bitrefill pause must return a stable paused code')
  assert(bitrefill.includes('status: 503'), 'Bitrefill pause must return a real service-paused status')
  assertOrder(bitrefill, "code: 'BITREFILL_PAUSED'", "req.headers.get('Authorization')", 'Bitrefill route must pause before auth/profile work')
  assertOrder(bitrefill, "code: 'BITREFILL_PAUSED'", 'const bitrefill = createBitrefillClient', 'Bitrefill route must pause before provider setup')
  assertOrder(bitrefill, "code: 'BITREFILL_PAUSED'", ".from('bitrefill_orders')", 'Bitrefill route must pause before local order creation')
  assertOrder(bitrefill, "code: 'BITREFILL_PAUSED'", 'debitResult = await applyWalletTransaction', 'Bitrefill route must pause before wallet debit')
  assertOrder(bitrefill, "code: 'BITREFILL_PAUSED'", 'const invoice = await bitrefill.createInvoice', 'Bitrefill route must pause before provider invoice creation')

  const cryptoTopup = read('supabase/functions/create-crypto-sell-order/index.ts')
  assert(cryptoTopup.includes("code: 'CRYPTO_TOPUP_PAUSED'"), 'crypto top-up pause must return a stable paused code')
  assert(cryptoTopup.includes('status: 503'), 'crypto top-up pause must return a real service-paused status')
  assertOrder(cryptoTopup, "code: 'CRYPTO_TOPUP_PAUSED'", "req.headers.get('Authorization')", 'crypto top-up route must pause before auth work')
  assertOrder(cryptoTopup, "code: 'CRYPTO_TOPUP_PAUSED'", 'const supabaseClient = createClient', 'crypto top-up route must pause before Supabase client setup')
  assertOrder(cryptoTopup, "code: 'CRYPTO_TOPUP_PAUSED'", 'const nowPaymentsClient = createNowPaymentsClient', 'crypto top-up route must pause before NOWPayments setup')
  assertOrder(cryptoTopup, "code: 'CRYPTO_TOPUP_PAUSED'", ".from('crypto_transactions')", 'crypto top-up route must pause before local crypto transaction rows')
  assertOrder(cryptoTopup, "code: 'CRYPTO_TOPUP_PAUSED'", 'payment = await nowPaymentsClient.createPayment', 'crypto top-up route must pause before provider payment creation')

  const smm = read('supabase/functions/smm-create-order/index.ts')
  assert(smm.includes("code: 'SMM_ORDERS_PAUSED'"), 'SMM order pause must return a stable paused code')
  assert(smm.includes('status: 503'), 'SMM order pause must return a real service-paused status')
  assertOrder(smm, "code: 'SMM_ORDERS_PAUSED'", "req.headers.get('Authorization')", 'SMM route must pause before auth work')
  assertOrder(smm, "code: 'SMM_ORDERS_PAUSED'", 'debitResult = await applyWalletTransaction', 'SMM route must pause before wallet debit')
  assertOrder(smm, "code: 'SMM_ORDERS_PAUSED'", 'smmClient.createOrder(orderParams)', 'SMM route must pause before panel dispatch')

  const sms = read('supabase/functions/smsbus/index.ts')
  assert(sms.includes("code: 'SMS_OTP_PAUSED'"), 'SMS OTP pause must return a stable paused code')
  assert(sms.includes('}, 503)'), 'SMS OTP pause must return a real service-paused status')
  assertOrder(sms, "code: 'SMS_OTP_PAUSED'", 'const { user, admin } = await requireAuth(req)', 'SMS create_otp must pause before auth/profile work')
  assertOrder(sms, "code: 'SMS_OTP_PAUSED'", "case 'create_otp'", 'SMS create_otp must pause before routing into the debit/provider handler')
  assert(sms.includes('debit = await debitWallet'), 'SMS create_otp handler must still use wallet debit when deliberately reopened')
  assert(sms.includes('number = await daisyGetNumber'), 'SMS create_otp handler must still isolate Daisy number allocation in the purchase handler')

  const telegram = read('supabase/functions/telegram-stars/index.ts')
  assert(telegram.includes("code: 'TELEGRAM_ORDERS_PAUSED'"), 'Telegram order pause must return a stable paused code')
  assert(telegram.includes('}, 503)'), 'Telegram order pause must return a real service-paused status')
  assertOrder(telegram, "code: 'TELEGRAM_ORDERS_PAUSED'", 'const user = await getUser(req)', 'Telegram create order actions must pause before auth/profile work')
  assertOrder(telegram, "code: 'TELEGRAM_ORDERS_PAUSED'", "case 'create_stars_order'", 'Telegram Stars must pause before routing into the debit/provider handler')
  assertOrder(telegram, "code: 'TELEGRAM_ORDERS_PAUSED'", "case 'create_premium_order'", 'Telegram Premium must pause before routing into the debit/provider handler')
  assert(telegram.includes('await deductWallet'), 'Telegram create handlers must still use wallet debit when deliberately reopened')
  assert(telegram.includes("istarPost('/orders/"), 'Telegram create handlers must still isolate iStar dispatch in the purchase handler')

  const referralWithdrawal = read('supabase/functions/withdraw-referral-balance/index.ts')
  assert(referralWithdrawal.includes("code: 'REFERRAL_WITHDRAWALS_PAUSED'"), 'referral withdrawal pause must return a stable paused code')
  assert(referralWithdrawal.includes('}, 503)'), 'referral withdrawal pause must return a real service-paused status')
  assert(!referralWithdrawal.includes("req.headers.get('Authorization')"), 'referral withdrawal hard pause must not do auth/profile work')
  assert(!referralWithdrawal.includes('createClient'), 'referral withdrawal hard pause must not initialize Supabase clients')
  assert(!referralWithdrawal.includes(".from('profiles')"), 'referral withdrawal hard pause must not read profile rows')
  assert(!referralWithdrawal.includes('withdraw_referral_balance_to_wallet'), 'referral withdrawal hard pause must not include the legacy balance-transfer RPC')

  const liveFulfillment = read('supabase/functions/muabanvia-fulfill/index.ts')
  assert(liveFulfillment.includes("code: 'LIVE_ACCOUNT_FULFILLMENT_PAUSED'"), 'live account fulfillment pause must return a stable paused code')
  assert(liveFulfillment.includes('}, 503)'), 'live account fulfillment pause must return a real service-paused status')
  assertOrder(liveFulfillment, "code: 'LIVE_ACCOUNT_FULFILLMENT_PAUSED'", 'const user = await getAuthenticatedUser(req)', 'live fulfillment route must pause before auth/profile work')
  assertOrder(liveFulfillment, "code: 'LIVE_ACCOUNT_FULFILLMENT_PAUSED'", ".from('profiles')", 'live fulfillment route must pause before admin profile reads')
  assertOrder(liveFulfillment, "code: 'LIVE_ACCOUNT_FULFILLMENT_PAUSED'", 'const response = await fetch', 'live fulfillment route must pause before supplier fetch')

  const manualRestock = read('supabase/functions/manual-restock/index.ts')
  assert(manualRestock.includes("code: 'MANUAL_RESTOCK_PAUSED'"), 'manual restock pause must return a stable paused code')
  assert(manualRestock.includes('}, 503)'), 'manual restock pause must return a real service-paused status')
  assertOrder(manualRestock, "code: 'MANUAL_RESTOCK_PAUSED'", "req.headers.get('Authorization')", 'manual restock route must pause before auth/profile work')
  assertOrder(manualRestock, "code: 'MANUAL_RESTOCK_PAUSED'", ".from('product_groups')", 'manual restock route must pause before product lookup')
  assertOrder(manualRestock, "code: 'MANUAL_RESTOCK_PAUSED'", 'const fulfillResponse = await fetch', 'manual restock route must pause before supplier fetch')
  assertOrder(manualRestock, "code: 'MANUAL_RESTOCK_PAUSED'", ".from('individual_accounts')", 'manual restock route must pause before inventory writes')

  const autoRestock = read('supabase/functions/auto-restock/index.ts')
  assert(autoRestock.includes("code: 'AUTO_RESTOCK_PAUSED'"), 'auto-restock pause must return a stable paused code')
  assert(autoRestock.includes('}, 503)'), 'auto-restock pause must return a real service-paused status')
  assertOrder(autoRestock, "code: 'AUTO_RESTOCK_PAUSED'", 'const supabaseAdmin = createClient', 'auto-restock route must pause before Supabase admin setup')
  assertOrder(autoRestock, "code: 'AUTO_RESTOCK_PAUSED'", ".from('product_groups')", 'auto-restock route must pause before product lookup')
  assertOrder(autoRestock, "code: 'AUTO_RESTOCK_PAUSED'", 'const fulfillResponse = await fetch', 'auto-restock route must pause before supplier fetch')
  assertOrder(autoRestock, "code: 'AUTO_RESTOCK_PAUSED'", ".from('individual_accounts')", 'auto-restock route must pause before inventory writes')
})

check('fulfillment routes authorize money before supplier dispatch or value release', () => {
  const product = read('supabase/functions/process-purchase/index.ts')
  const productAuthorization = product.indexOf("'authorize_product_purchase'")
  const productAccounts = product.indexOf('const { data: purchasedAccounts')
  const productSecrets = product.indexOf('const accountDetails = {')
  const productCompletion = product.indexOf("'complete_product_purchase'")
  assert(product.includes('const liveAccountFulfillmentEnabled = false'), 'live account supplier fallback must remain hard-paused')
  assert(product.includes('PURCHASE_LEDGER_ORPHANED'), 'product purchases must block orphaned purchase-ledger retries')
  assert(productAuthorization > -1 && productAccounts > -1 && productAuthorization < productAccounts, 'product inventory must be reserved by the atomic authorization boundary')
  assert(productAccounts > -1 && productSecrets > -1 && productAccounts < productSecrets, 'product credentials must be assembled only after inventory is held')
  assert(productSecrets > -1 && productCompletion > -1 && productSecrets < productCompletion, 'product completion must capture and persist credentials through the atomic boundary')

  const smm = read('supabase/functions/smm-create-order/index.ts')
  const smmDebit = smm.indexOf('const debitResult = await applyWalletTransaction')
  const smmLocalOrder = smm.indexOf(".from('smm_orders')\n      .insert(orderData)")
  const smmProvider = smm.indexOf('const panelResponse = await smmClient.createOrder')
  assert(smm.includes('SMM_PURCHASE_LEDGER_ORPHANED'), 'SMM purchases must block orphaned purchase-ledger retries')
  assert(smm.includes('if (orphanedPurchaseTx && !existingOrder)'), 'SMM orphaned purchase-ledger block must not reject exact existing-order replays')
  assert(smmDebit > -1 && smmLocalOrder > -1 && smmDebit < smmLocalOrder, 'SMM local order must be created only after wallet debit')
  assert(smmLocalOrder > -1 && smmProvider > -1 && smmLocalOrder < smmProvider, 'SMM supplier call must happen only after local order exists')

  const sms = read('supabase/functions/smsbus/index.ts')
  const smsDebit = sms.indexOf('debit = await debitWallet')
  const smsPendingOrder = sms.indexOf('pending_provider_allocation: true')
  const smsProvider = sms.indexOf('number = await daisyGetNumber')
  const smsActiveUpdate = sms.indexOf("status: 'active'")
  assert(sms.includes('SMS_PURCHASE_LEDGER_ORPHANED'), 'SMS purchases must block orphaned purchase-ledger retries')
  assert(sms.includes('if (orphanedPurchaseTx && !existing)'), 'SMS orphaned purchase-ledger block must not reject exact existing-order replays')
  assert(smsDebit > -1 && smsPendingOrder > -1 && smsDebit < smsPendingOrder, 'SMS pending order must be created after wallet debit')
  assert(smsPendingOrder > -1 && smsProvider > -1 && smsPendingOrder < smsProvider, 'Daisy number allocation must happen only after pending local SMS order exists')
  assert(smsProvider > -1 && smsActiveUpdate > -1 && smsProvider < smsActiveUpdate, 'SMS order must become active only after provider allocation succeeds')

  const telegram = read('supabase/functions/telegram-stars/index.ts')
  const telegramStarsOrder = telegram.indexOf("order_type: 'stars'")
  const telegramStarsDebit = telegram.indexOf('await deductWallet(admin, userId, priceNgn, reference')
  const telegramStarsProvider = telegram.indexOf("await istarPost('/orders/star'")
  const telegramPremiumOrder = telegram.indexOf("order_type: 'premium'")
  const telegramPremiumDebit = telegram.indexOf('await deductWallet(admin, userId, chargeNgn, reference')
  const telegramPremiumProvider = telegram.indexOf("await istarPost('/orders/premium'")
  assert(telegramStarsOrder > -1 && telegramStarsDebit > telegramStarsOrder && telegramStarsProvider > telegramStarsDebit, 'Telegram Stars must create local order, debit wallet, then call iStar')
  assert(telegramPremiumOrder > -1 && telegramPremiumDebit > telegramPremiumOrder && telegramPremiumProvider > telegramPremiumDebit, 'Telegram Premium must create local order, debit wallet, then call iStar')
  assert(!telegram.includes(".from('telegram_orders').delete()"), 'Telegram denied/debit-failed orders must not be deleted because they are incident evidence')
  assert(telegram.includes('Wallet debit failed before supplier dispatch'), 'Telegram debit failure must preserve a failed local order record')
})

check('wallet purchase ledgers carry request forensics on high-risk routes', () => {
  for (const [path, route] of [
    ['supabase/functions/process-purchase/index.ts', 'process-purchase'],
    ['supabase/functions/smm-create-order/index.ts', 'smm-create-order'],
    ['supabase/functions/smsbus/index.ts', 'smsbus:create-otp'],
    ['supabase/functions/telegram-stars/index.ts', 'telegram-stars:create-stars-order'],
    ['supabase/functions/purchase-bills/index.ts', 'purchase-bills'],
    ['supabase/functions/purchase-bitrefill/index.ts', 'purchase-bitrefill'],
    ['supabase/functions/create-withdrawal-request/index.ts', 'create-withdrawal-request'],
  ]) {
    const src = read(path)
    assert(src.includes('async function getWalletRequestForensics'), `${path} missing request forensics helper`)
    assert(src.includes('request_id:'), `${path} request forensics must carry request_id`)
    assert(src.includes('ip_address:'), `${path} request forensics must carry ip_address`)
    assert(src.includes('user_agent_hash:'), `${path} request forensics must carry user_agent_hash`)
    assert(src.includes(`'${route}'`), `${path} missing expected forensic route label ${route}`)
    assert(src.includes('request_forensics: walletRequestForensics'), `${path} wallet metadata must include request_forensics`)
  }

  const telegram = read('supabase/functions/telegram-stars/index.ts')
  assert(telegram.includes("'telegram-stars:create-premium-order'"), 'Telegram Premium must carry its own forensic route label')
})

check('customer order history reveals credentials only for completed orders', () => {
  const data = read('src/lib/supabase.ts')
  assert(data.includes('function sanitizeOrderHistoryCredentialVisibility'), 'getUserOrders must sanitize credential visibility')
  assert(data.includes("String(order?.status || '').toLowerCase() === 'completed'"), 'order history sanitizer must preserve credentials only for completed orders')
  assert(data.includes('(data || []).map(sanitizeOrderHistoryCredentialVisibility)'), 'getUserOrders must apply credential sanitizer')
  assert(data.includes('account_details: {'), 'sanitizer must replace non-completed account_details with a safe projection')

  const page = read('src/pages/OrderHistoryPage.tsx')
  assert(page.includes('function isCredentialVisibleOrder'), 'OrderHistoryPage must centralize credential visibility')
  assert(page.includes('if (!isCredentialVisibleOrder(order)) return []'), 'getOrderAccounts must return no credentials for non-completed orders')
  assert(page.includes('Credentials are only available after the order is completed.'), 'copy/download paths must explain completed-only access')
  assert(page.includes('const credentialPreview = firstAccount.username || firstAccount.email || \'\''), 'order cards must not preview raw account_details for non-completed orders')
})

check('mapped purchase routes check current suspension before debit or dispatch', () => {
  const product = read('supabase/functions/process-purchase/index.ts')
  for (const [path, src] of [
    ['supabase/functions/process-purchase/index.ts', product],
    ['supabase/functions/smm-create-order/index.ts', read('supabase/functions/smm-create-order/index.ts')],
    ['supabase/functions/smsbus/index.ts', read('supabase/functions/smsbus/index.ts')],
    ['supabase/functions/telegram-stars/index.ts', read('supabase/functions/telegram-stars/index.ts')],
  ]) {
    assert(src.includes('fraud_device_bans'), `${path} must check active fraud IP/device bans before purchase`)
    assert(src.includes(".eq('active', true)") || src.includes('.eq("active", true)'), `${path} fraud ban lookup must require active bans`)
    assert(src.includes('user_agent_hash'), `${path} must check device/user-agent hash bans before purchase`)
    assert(src.includes('account_suspended'), `${path} must load current account suspension state before purchase`)
  }
  const productGuard = product.indexOf('await assertPurchasingCustomer(supabaseAdmin, user.id, req)')
  const productAuthorization = product.indexOf("'authorize_product_purchase'")
  const productSecrets = product.indexOf('const accountDetails = {')
  const productCompletion = product.indexOf("'complete_product_purchase'")
  assert(productGuard > -1, 'product purchase must check current purchase permission')
  assert(productGuard < productAuthorization, 'product purchase must check suspension before financial authorization')
  assert(productGuard < productSecrets, 'product purchase must check suspension before credential assembly')
  assert(productGuard < productCompletion, 'product purchase must check suspension before atomic completion')

  const smm = read('supabase/functions/smm-create-order/index.ts')
  const smmGuard = smm.indexOf('await assertPurchasingCustomer(supabaseAdmin, user.id, req)')
  const smmDebit = smm.indexOf('const debitResult = await applyWalletTransaction')
  const smmProvider = smm.indexOf('const panelResponse = await smmClient.createOrder')
  assert(smmGuard > -1, 'SMM purchase must check current purchase permission')
  assert(smmGuard < smmDebit, 'SMM purchase must check suspension before wallet debit')
  assert(smmGuard < smmProvider, 'SMM purchase must check suspension before supplier dispatch')

  const sms = read('supabase/functions/smsbus/index.ts')
  const smsGuard = sms.indexOf('await assertPurchasingCustomer(admin, userId, req)')
  const smsDebit = sms.indexOf('debit = await debitWallet')
  const smsProvider = sms.indexOf('number = await daisyGetNumber')
  assert(smsGuard > -1, 'SMS purchase must check current purchase permission')
  assert(smsGuard < smsDebit, 'SMS purchase must check suspension before wallet debit')
  assert(smsGuard < smsProvider, 'SMS purchase must check suspension before Daisy allocation')

  const telegram = read('supabase/functions/telegram-stars/index.ts')
  const starHandler = telegram.indexOf('async function handleCreateStarsOrder')
  const starGuard = telegram.indexOf('await assertPurchasingCustomer(admin, userId, req)', starHandler)
  const starDebit = telegram.indexOf('await deductWallet(admin, userId, priceNgn, reference', starHandler)
  const starProvider = telegram.indexOf("const istarOrder = await istarPost('/orders/star'", starHandler)
  const premiumHandler = telegram.indexOf('async function handleCreatePremiumOrder')
  const premiumGuard = telegram.indexOf('await assertPurchasingCustomer(admin, userId, req)', premiumHandler)
  const premiumDebit = telegram.indexOf('await deductWallet(admin, userId, chargeNgn, reference', premiumHandler)
  const premiumProvider = telegram.indexOf("const istarOrder = await istarPost('/orders/premium'", premiumHandler)
  assert(starGuard > starHandler, 'Telegram Stars must check current purchase permission')
  assert(starGuard < starDebit, 'Telegram Stars must check suspension before wallet debit')
  assert(starGuard < starProvider, 'Telegram Stars must check suspension before iStar dispatch')
  assert(premiumGuard > premiumHandler, 'Telegram Premium must check current purchase permission')
  assert(premiumGuard < premiumDebit, 'Telegram Premium must check suspension before wallet debit')
  assert(premiumGuard < premiumProvider, 'Telegram Premium must check suspension before iStar dispatch')
})

check('frozen customers keep read-only order history and support access', () => {
  const auth = read('src/contexts/SimpleAuth.tsx')
  assert(auth.includes('accountSuspended: boolean'), 'auth context must expose account suspension state')
  assert(auth.includes("select('is_staff, wallet_balance, account_suspended, suspension_reason')"), 'auth context must load suspension state with profile')
  assert(auth.includes('setAccountSuspended(Boolean(data?.account_suspended))'), 'auth context must update account suspension state')

  const protectedRoute = read('src/components/SimpleProtectedRoute.tsx')
  assert(!protectedRoute.includes('accountSuspended'), 'protected route must not globally redirect suspended customers away from history/support')

  const app = read('src/App.tsx')
  assert(app.includes('path="/orders"'), 'order history route must remain mounted')
  assert(app.includes('<OrderHistoryPage />'), 'order history page must remain mounted')
  assert(app.includes('path="/support"'), 'support route must remain mounted')
  assert(app.includes('<SupportPage />'), 'support page must remain mounted')

  const orders = read('src/pages/OrderHistoryPage.tsx')
  assert(orders.includes('accountSuspended, suspensionReason'), 'order history must read suspension state')
  assert(orders.includes('You can still review completed orders, copy credentials, download credentials, and contact support.'), 'order history must explicitly preserve read-only access while suspended')
  assert(orders.includes('!accountSuspended && recommendationProducts.length > 0'), 'order history must suppress purchase recommendations while suspended')
  assert(orders.includes('{!accountSuspended && ('), 'order history must hide shop CTA while suspended')

  const support = read('src/pages/SupportPage.tsx')
  assert(support.includes('accountSuspended, suspensionReason'), 'support page must read suspension state')
  assert(support.includes('You can still use this page, review your order history, and send support'), 'support page must stay useful while suspended')
})

check('mapped purchase routes validate hostile quantity and price input', () => {
  const product = read('supabase/functions/process-purchase/index.ts')
  assert(product.includes('!Number.isInteger(quantity) || quantity < 1'), 'product checkout must reject non-integer or negative quantities')
  assert(product.includes('quantity > 500'), 'product checkout must cap quantity')
  assert(product.includes('!Number.isFinite(expectedAmountNgn) || expectedAmountNgn <= 0'), 'product checkout must require a positive displayed amount')
  assert(product.includes('Math.abs(expectedAmountNgn - totalPrice) > 1'), 'product checkout must compare expected amount to server price')

  const smm = read('supabase/functions/smm-create-order/index.ts')
  assert(smm.includes('!Number.isInteger(actualQuantity) || actualQuantity < 1'), 'SMM checkout must reject non-integer or negative quantities')
  assert(smm.includes('actualQuantity > service.max_quantity'), 'SMM checkout must enforce provider max quantity')
  assert(smm.includes('!Number.isFinite(expectedPriceNgn) || expectedPriceNgn <= 0'), 'SMM checkout must require a positive displayed price')
  assert(smm.includes('expectedPriceNgn !== totalAmount'), 'SMM checkout must compare expected price to server price')

  const sms = read('supabase/functions/smsbus/index.ts')
  assert(sms.includes('!Number.isFinite(expectedPriceNgn) || expectedPriceNgn <= 0'), 'SMS checkout must require a positive displayed price')
  assert(sms.includes('expectedPriceNgn !== estimatedPriceNgn'), 'SMS checkout must compare expected price to server price')
  assert(sms.includes('effectivePricing.providerCostNgn > estimatedPriceNgn'), 'SMS checkout must cancel if provider price exceeds customer price')

  const telegram = read('supabase/functions/telegram-stars/index.ts')
  assert(telegram.includes('!Number.isInteger(quantity) || quantity < 50'), 'Telegram Stars must reject malformed or too-small quantities')
  assert(telegram.includes('quantity > 1_000_000'), 'Telegram Stars must cap quantity')
  assert(telegram.includes('const priceNgn = calculateStarPriceNgn(quantity, config)'), 'Telegram Stars price must be server-computed')
  assert(telegram.includes('const chargeNgn = livePrice || product.price_ngn'), 'Telegram Premium price must be server-computed from product/config')

  const bitrefill = read('supabase/functions/purchase-bitrefill/index.ts')
  assert(bitrefill.includes('!Number.isInteger(qty) || qty < 1 || qty > 20'), 'Bitrefill checkout must reject malformed or out-of-range quantities')
  assert(bitrefill.includes('!Number.isFinite(expectedAmountNgn) || expectedAmountNgn <= 0'), 'Bitrefill checkout must require a positive displayed amount')
  assert(bitrefill.includes('Math.abs(expectedAmountNgn - chargeNgn) > 1'), 'Bitrefill checkout must compare expected amount to server price')
})

check('wallet money boundaries reject precision, currency, and overflow hazards', () => {
  const validAmounts = ['0.01', '1', '1.2', '1.23', '999999999.99', '1000000000.00']
  for (const value of validAmounts) {
    assert(parseExactPositiveMoneyForTest(value) > 0n, `valid amount rejected by generated boundary test: ${value}`)
  }

  for (const value of [
    '',
    ' ',
    '0',
    '0.00',
    '-1',
    '+1',
    '01',
    '1.234',
    'NaN',
    'Infinity',
    '1e3',
    '1000000000.01',
  ]) {
    assertThrows(() => parseExactPositiveMoneyForTest(value), `invalid amount accepted by generated boundary test: ${value}`)
  }

  assert(normalizeCurrencyForTest('ngn') === 'NGN', 'currency normalization must uppercase NGN')
  assert(normalizeCurrencyForTest(' USD ') === 'USD', 'currency normalization must trim and uppercase USD')
  assert(normalizeCurrencyForTest('') === 'NGN', 'blank currency must default to NGN')
  for (const value of ['N', 'TOO-LONG', 'NG1', '₦NG']) {
    assertThrows(() => normalizeCurrencyForTest(value), `invalid currency accepted by generated boundary test: ${value}`)
  }

  const walletEngine = read('supabase/migrations/20260919001000_enforce_backed_wallet_purchases.sql')
  assert(walletEngine.includes("v_amount::text = 'NaN'"), 'wallet engine must reject numeric NaN')
  assert(walletEngine.includes('v_amount <> round(v_amount, 2)'), 'wallet engine must reject over-precise amounts')
  assert(walletEngine.includes('v_amount > 1000000000'), 'wallet engine must cap unusually large wallet movements')
  assert(walletEngine.includes("v_currency !~ '^[A-Z]{3,8}$'"), 'wallet engine must reject malformed currency codes')
  assert(walletEngine.includes('upper(COALESCE(NULLIF(trim(p_currency), \'\'), \'NGN\'))'), 'wallet engine must normalize currency before ledger insert')

  const bounds = read('supabase/migrations/20260919013000_enforce_wallet_money_bounds.sql')
  assert(bounds.includes('transactions_amount_money_bounds'), 'transactions must have amount money-bound constraint')
  assert(bounds.includes('transactions_balance_snapshot_money_bounds'), 'transactions must have balance snapshot money-bound constraint')
  assert(bounds.includes('transactions_currency_code_bounds'), 'transactions must have currency code constraint')
  assert(bounds.includes('profiles_balance_money_bounds'), 'profile balances must have money-bound constraint')
  assert(bounds.includes('amount = round(amount, 2)'), 'transaction amount constraint must enforce two-decimal precision')
  assert(bounds.includes('abs(amount) <= 1000000000'), 'transaction amount constraint must enforce upper bound')
  assert(bounds.includes("currency ~ '^[A-Z]{3,8}$'"), 'transaction currency constraint must enforce uppercase currency codes')
  assert(bounds.includes(') NOT VALID;'), 'money-bound constraints must preserve historical evidence while protecting new writes')
})

check('mapped purchase routes bind idempotency keys to request contents', () => {
  const product = read('supabase/functions/process-purchase/index.ts')
  assert(product.includes('IDEMPOTENCY_REQUEST_CONFLICT'), 'product checkout must reject idempotency key reuse with changed request contents')
  assert(product.includes("String(existingOrder.product_group_id || '') === product_group_id"), 'product idempotency must bind product_group_id')
  assert(product.includes('existingQuantity === quantity'), 'product idempotency must bind quantity')
  assert(product.includes('Math.abs(existingAmount - expectedAmountNgn) <= 1'), 'product idempotency must bind charged amount')

  const smm = read('supabase/functions/smm-create-order/index.ts')
  assert(smm.includes('IDEMPOTENCY_REQUEST_CONFLICT'), 'SMM checkout must reject idempotency key reuse with changed request contents')
  assert(smm.includes("String(existingOrder.service_id || '') === String(service.id)"), 'SMM idempotency must bind service id')
  assert(smm.includes('Number(existingOrder.quantity || 0) === actualQuantity'), 'SMM idempotency must bind quantity')
  assert(smm.includes('Number(existingOrder.amount_ngn || 0) === totalAmount'), 'SMM idempotency must bind amount')
  assert(smm.includes("String(existingOrder.link || '') === String(link || '')"), 'SMM idempotency must bind target link')

  const sms = read('supabase/functions/smsbus/index.ts')
  assert(sms.includes('IDEMPOTENCY_REQUEST_CONFLICT'), 'SMS checkout must reject idempotency key reuse with changed request contents')
  assert(sms.includes("String(existing.service_id || '') === serviceCode"), 'SMS idempotency must bind service code')
  assert(sms.includes('Number(existing.price_ngn || 0) === estimatedPriceNgn'), 'SMS idempotency must bind charged price')
  assert(sms.includes("String(existing.order_type || '') === 'otp'"), 'SMS idempotency must bind order type')

  const telegram = read('supabase/functions/telegram-stars/index.ts')
  const telegramPage = read('src/pages/TelegramStarsPage.tsx')
  const telegramMigration = read('supabase/migrations/20260919022000_add_telegram_order_idempotency.sql')
  assert(telegramPage.includes('createTelegramIdempotencyKey'), 'Telegram frontend must generate purchase idempotency keys')
  assert(telegramMigration.includes('idx_telegram_orders_user_idempotency_key_unique'), 'Telegram orders must enforce per-user idempotency uniqueness')
  assert(telegram.includes('normalizeIdempotencyKey(body.idempotency_key)'), 'Telegram checkout must validate client idempotency keys')
  assert(telegram.includes('IDEMPOTENCY_REQUEST_CONFLICT'), 'Telegram checkout must reject idempotency key reuse with changed request contents')
  assert(telegram.includes("String(existingOrder.order_type || '') === 'stars'"), 'Telegram Stars idempotency must bind order type')
  assert(telegram.includes("String(existingOrder.order_type || '') === 'premium'"), 'Telegram Premium idempotency must bind order type')
  assert(telegram.includes("String(existingOrder.recipient_hash || '') === recipientHash"), 'Telegram idempotency must bind recipient hash')
  assert(telegram.includes('Number(existingOrder.price_ngn || 0) === priceNgn'), 'Telegram Stars idempotency must bind charged price')
  assert(telegram.includes('Number(existingOrder.price_ngn || 0) === Number(chargeNgn || 0)'), 'Telegram Premium idempotency must bind charged price')
  assert(telegram.includes('TELEGRAM_PURCHASE_LEDGER_ORPHANED'), 'Telegram checkout must block orphaned purchase ledger retries')
})

check('paused provider-money routes keep local records and wallet debits before provider calls', () => {
  const bills = read('supabase/functions/purchase-bills/index.ts')
  const billsLocalRecord = bills.indexOf(".from('bills_transactions')")
  const billsDebit = bills.indexOf('debitResult = await applyWalletTransaction')
  const billsAirtimeProvider = bills.indexOf('purchaseResponse = await sageCloudClient.purchaseAirtime')
  const billsDataProvider = bills.indexOf('purchaseResponse = await sageCloudClient.purchaseData')
  assert(bills.includes('BILLS_ENABLED'), 'bills route must remain behind the BILLS_ENABLED fail-closed gate')
  assert(bills.includes("if (payment_source !== 'wallet')"), 'bills route must reject non-wallet payment sources during incident review')
  assert(billsLocalRecord > -1 && billsDebit > billsLocalRecord, 'bills route must create a local transaction before wallet debit')
  assert(billsDebit > -1 && billsAirtimeProvider > billsDebit, 'airtime provider call must happen after wallet debit')
  assert(billsDebit > -1 && billsDataProvider > billsDebit, 'data provider call must happen after wallet debit')
  assert(!bills.includes(".from('bills_transactions')\n        .delete()"), 'bills debit-failed transaction records must be preserved as failed evidence')
  assert(bills.includes("stage: 'wallet_debit'"), 'bills debit failure must store wallet_debit evidence on the local record')

  const bitrefill = read('supabase/functions/purchase-bitrefill/index.ts')
  const bitrefillLocalOrder = bitrefill.indexOf(".from('bitrefill_orders')")
  const bitrefillDebit = bitrefill.indexOf('debitResult = await applyWalletTransaction')
  const bitrefillProvider = bitrefill.indexOf('const invoice = await bitrefill.createInvoice')
  assert(bitrefill.includes('BITREFILL_ENABLED'), 'Bitrefill route must remain behind the BITREFILL_ENABLED fail-closed gate')
  assert(bitrefill.includes("if (payment_source !== 'wallet')"), 'Bitrefill route must reject non-wallet payment sources during incident review')
  assert(bitrefillLocalOrder > -1 && bitrefillDebit > bitrefillLocalOrder, 'Bitrefill route must create a local order before wallet debit')
  assert(bitrefillDebit > -1 && bitrefillProvider > bitrefillDebit, 'Bitrefill provider order must happen after wallet debit')
  assert(!bitrefill.includes(".from('bitrefill_orders').delete()"), 'Bitrefill debit-failed order records must be preserved as failed evidence')
  assert(bitrefill.includes("stage: 'wallet_debit'"), 'Bitrefill debit failure must store wallet_debit evidence on the local order')

  const withdrawal = read('supabase/functions/create-withdrawal-request/index.ts')
  const withdrawalLocalRecord = withdrawal.indexOf(".from('crypto_withdrawals')")
  const withdrawalDebit = withdrawal.indexOf('await applyWalletTransaction(supabaseAdmin, {\n        userId: user.id,\n        type: \'withdrawal\'')
  const withdrawalProvider = withdrawal.indexOf('transferResponse = await sageCloudClient.transfer')
  assert(withdrawal.includes('WITHDRAWALS_ENABLED'), 'withdrawal route must remain behind the WITHDRAWALS_ENABLED fail-closed gate')
  assert(withdrawalLocalRecord > -1 && withdrawalDebit > withdrawalLocalRecord, 'withdrawal route must create a local withdrawal row before wallet debit')
  assert(withdrawalDebit > -1 && withdrawalProvider > withdrawalDebit, 'withdrawal provider transfer must happen after wallet debit')
  assert(!withdrawal.includes(".from('crypto_withdrawals')\n        .delete()"), 'withdrawal debit-failed records must be preserved as failed evidence')
  assert(withdrawal.includes("stage: 'wallet_debit'"), 'withdrawal debit failure must store wallet_debit evidence on the local record')
  assert(withdrawal.includes('source_debit_transaction_id: debitResult?.transaction?.id || null'), 'withdrawal refunds must keep original debit transaction id')
  assert(withdrawal.includes('source_debit_idempotency_key: debitIdempotencyKey'), 'withdrawal refunds must keep original debit idempotency key')
  assert(withdrawal.includes('request_forensics: walletRequestForensics'), 'withdrawal wallet metadata must carry request forensics')
})

check('server code has no direct profile balance update literals', () => {
  const files = [
    ...walk('supabase/functions'),
    ...walk('api'),
    ...walk('pages/api'),
  ].filter((path) => /\.(ts|tsx|js|mjs)$/.test(path))

  const offenders = []
  const updatePattern = /\.update\s*\(\s*\{[^}]*\b(wallet_balance|crypto_balance|referral_balance)\b/s
  const insertPattern = /\.insert\s*\(\s*\{[^}]*\b(wallet_balance|crypto_balance|referral_balance)\b/s

  for (const path of files) {
    const src = read(path)
    if (updatePattern.test(src) || insertPattern.test(src)) offenders.push(path)
  }

  assert(offenders.length === 0, `direct profile balance write literals found: ${offenders.join(', ')}`)
})

check('server code has no direct wallet ledger mutations outside audited repair', () => {
  const pkg = read('package.json')
  const localSuite = read('scripts/wallet-local-security-suite.mjs')
  const testReport = read('docs/security/wallet-test-report.md')
  const sourceAudit = read('scripts/wallet-source-mutation-audit.mjs')
  const files = [
    ...walk('supabase/functions'),
    ...walk('api'),
    ...walk('pages/api'),
  ].filter((path) => /\.(ts|tsx|js|mjs)$/.test(path))

  const offenders = []
  const transactionTableReferencePattern = /\.from\(['"]transactions['"]\)/g
  const transactionMutationInChainPattern = /\.(insert|update|delete|upsert)\s*\(/

  for (const path of files) {
    const src = read(path)
    for (const match of src.matchAll(transactionTableReferencePattern)) {
      const segment = statementSegment(src, match.index ?? 0)
      if (!transactionMutationInChainPattern.test(segment)) continue
      const isAuditedRepair =
        path === 'supabase/functions/admin-adjust-balance/index.ts' &&
        segment.includes('.insert(repairPayload)') &&
        segment.includes(".select('*')") &&
        src.includes("body?.action === 'record_ledger_credit'") &&
        src.includes("source: 'admin-ledger-repair'") &&
        src.includes('balance_unchanged: true') &&
        src.includes('requires_owner_evidence: true')

      if (!isAuditedRepair) offenders.push(`${path}:${match.index}`)
    }
  }

  assert(pkg.includes('"security:wallet:source-mutations": "node scripts/wallet-source-mutation-audit.mjs"'), 'package script must expose source mutation audit')
  assert(localSuite.includes('scripts/wallet-source-mutation-audit.mjs'), 'local wallet suite must run source mutation audit')
  assert(testReport.includes('npm run security:wallet:source-mutations'), 'test report must record source mutation audit evidence')
  assert(sourceAudit.includes('legacyWalletRpcPattern'), 'source mutation audit must scan legacy wallet RPC calls')
  assert(sourceAudit.includes('directProfileBalanceWritePattern'), 'source mutation audit must scan protected profile balance writes')
  assert(sourceAudit.includes('transactionTableReferencePattern'), 'source mutation audit must scan transaction table references')
  assert(sourceAudit.includes('requiredSegmentMarkers'), 'source mutation audit must scope approved direct transaction exceptions to exact statement segments')
  assert(sourceAudit.includes('.insert(repairPayload)'), 'source mutation audit must approve only the balance-neutral repair insert statement')
  assert(sourceAudit.includes('statementSegment'), 'source mutation audit must isolate Supabase chains before flagging transaction mutations')
  assert(offenders.length === 0, `direct wallet ledger mutations found outside audited repair: ${offenders.join(', ')}`)
})

check('read-only reconciliation command is guarded against unsafe use', () => {
  const script = read('scripts/wallet-reconcile-readonly.mjs')
  const queryPack = read('docs/security/wallet-readonly-query-pack.sql')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:reconcile": "node scripts/wallet-reconcile-readonly.mjs"'), 'package script must expose the read-only reconciliation command')
  assert(script.includes('TALLYSTORE_RECONCILE_ENV'), 'reconciliation command must require an explicit environment')
  assert(script.includes('--allow-production'), 'production reconciliation must require an explicit production flag')
  assert(script.includes('TALLYSTORE_RECONCILE_READONLY'), 'reconciliation command must require the read-only acknowledgement')
  assert(script.includes('wallet-reconcile-readonly refused'), 'reconciliation command must fail closed with an explicit refusal')
  assert(script.includes('SUPABASE_SERVICE_ROLE_KEY'), 'owner evidence collection must use an explicit server-side key')
  assert(script.includes('--history-csv'), 'reconciliation command must support offline CSV evidence review')
  assert(script.includes('--self-test'), 'reconciliation command must expose a no-Supabase self-test')
  assert(script.includes('runSelfTest'), 'reconciliation command must implement a self-test')
  assert(script.includes('looseRefundsDoNotCreateTrustedFunds'), 'reconciliation self-test must prove loose refunds do not create trusted funds')
  assert(script.includes('forgedTrustedMarkersDoNotCreateTrustedFunds'), 'reconciliation self-test must prove forged trusted markers do not create trusted funds')
  assert(script.includes('offlineCsvMode'), 'offline CSV mode must bypass live Supabase requirements')
  assert(script.includes('parseCsvText'), 'offline CSV mode must parse exported CSV evidence')
  assert(script.includes('classifyHistoryCsvFile'), 'offline CSV mode must classify raw versus derived/supporting CSV files')
  assert(script.includes('supporting_derived_analysis'), 'offline CSV mode must label derived analysis as supporting evidence')
  assert(script.includes('countedInTotals: false'), 'offline CSV mode must exclude derived/supporting files from totals')
  assert(script.includes('Derived analysis rows are not independent transaction/order evidence'), 'offline CSV mode must document derived-row exclusion')
  assert(script.includes('supporting_unknown_schema'), 'offline CSV mode must exclude unrecognized CSV schemas from totals')
  assert(script.includes('duplicateExportRows'), 'offline CSV mode must dedupe repeated exported rows/files')
  assert(script.includes('matchedOrderRowsExcludedFromLossTotal'), 'offline CSV mode must avoid double-counting matching order rows as losses')
  assert(script.includes('dedupedRecordedPurchaseValue'), 'offline CSV mode must report a deduped recorded purchase value')
  assert(script.includes('failedOrRefundedRowsWithDebits'), 'reconciliation command must report failed/refunded rows that still have posted debits')
  assert(script.includes('unresolvedDebitAmount'), 'reconciliation command must report unresolved failed/refunded debit exposure')
  const localSuite = read('scripts/wallet-local-security-suite.mjs')
  assert(localSuite.includes("['node', ['scripts/wallet-reconcile-readonly.mjs', '--self-test']"), 'local suite must run read-only reconciliation self-test without Supabase credentials')
  assert(script.includes('trustedDebitCapacity = Math.min(grossDebits, trustedCredits)'), 'reconciliation command must cap refunds by trusted principal')
  assert(script.includes('findTrustedOriginalDebit'), 'reconciliation command must link refunds to original trusted debits')
  assert(script.includes("String(metadata.trusted_principal_authorized || '').toLowerCase() !== 'true'"), 'reconciliation command must count only trusted-principal-authorized original debits for refund restoration')
  assert(script.includes('metadata.trusted_principal_debit_amount'), 'reconciliation command must require trusted-principal debit amount evidence for refund restoration')
  assert(script.includes('linkedEligibleRefunds'), 'reconciliation command must report linked eligible refunds separately from raw refunds')
  assert(script.includes('eligibleRefunds = Math.min(linkedEligibleRefunds, trustedDebitCapacity)'), 'reconciliation command must not treat raw refunds as eligible restoration')
  assert(script.includes('backedAvailable: Math.max(trustedCredits - trustedConsumedSpend, 0)'), 'reconciliation command must not add refunds as principal')
  assert(script.includes('const WALLET_DEBIT_TYPES = ['), 'reconciliation command must centralize wallet debit classification')
  for (const type of ['purchase', 'admin_debit', 'staff_debit', 'debit', 'withdrawal', 'chargeback', 'correction_debit']) {
    assert(script.includes(`'${type}'`), `reconciliation command must include ${type} in wallet debit classification`)
  }
  assert(script.includes('const isDebit = WALLET_DEBIT_TYPES.includes(type)'), 'reconciliation drill-down must use the same debit list as backing totals')
  assert(script.includes('async function loadAdminActorIds'), 'reconciliation command must load admin actor evidence')
  assert(script.includes('isVerifiedGatewayCredit'), 'reconciliation command must centralize verified gateway credit checks')
  assert(script.includes('pendingPayments'), 'reconciliation command must load pending payment evidence for Ercas deposits')
  assert(script.includes("paymentStatus === 'credited'"), 'reconciliation command must not count merely pending Ercas payment evidence as trusted principal')
  assert(script.includes('pocketfiWebhookLogs'), 'reconciliation command must load PocketFi webhook evidence for bank-transfer deposits')
  assert(script.includes('verified_amount_ngn'), 'reconciliation command must require provider-verified amount metadata')
  assert(script.includes('Boolean(log.processed) === true'), 'reconciliation command must require processed PocketFi webhook evidence')
  assert(script.includes('toCents(number(log.verified_amount_ngn)) === toCents(amount)'), 'reconciliation command must require matching PocketFi verified amount evidence')
  assert(script.includes('log.verified_reference'), 'reconciliation command must require matching PocketFi verified reference evidence')
  assert(
    script.includes("type === 'admin_credit'")
      && script.includes('adminActorIds.has(String(row.created_by || \'\'))')
      && script.includes('hasApprovedAdminCreditEvidence(row, metadata)'),
    'reconciliation command must only count admin_credit rows created by admins with approval evidence',
  )
  assert(script.includes('function hasApprovedAdminCreditEvidence'), 'reconciliation command must require explicit admin-credit approval metadata')
  assert(script.includes('metadata.approved_by'), 'reconciliation command must require admin_credit approved_by metadata')
  assert(script.includes('metadata.approval_reference'), 'reconciliation command must require admin_credit approval_reference metadata')
  assert(script.includes('const isBalanceNeutralAdminRepair'), 'reconciliation command must identify audit-only admin repair rows')
  assert(script.includes("metadata.source || '') === 'admin-ledger-repair'"), 'reconciliation command must exclude admin ledger repair rows from trusted principal')
  assert(script.includes('balanceAfter <= balanceBefore'), 'reconciliation command must require trusted admin credits to increase balance')
  for (const type of ['staff_credit', 'promotion_credit', 'correction_credit']) {
    assert(!script.includes(`'${type}'`), `reconciliation command must not trust ${type}`)
  }
  assert(!script.includes("'deposit', 'credit'"), 'reconciliation command must not trust generic credit rows as principal')
  assert(queryPack.includes('least(c.wallet_debits, c.trusted_credits) as trusted_debit_capacity'), 'read-only query pack must report trusted debit capacity')
  assert(queryPack.includes('linked_eligible_refunds'), 'read-only query pack must report linked eligible refunds instead of raw refund totals')
  assert(queryPack.includes('eligible_refund_matches'), 'read-only query pack must link refunds to original trusted debits')
  assert(queryPack.includes("coalesce(d.metadata->>'trusted_principal_authorized', '') = 'true'"), 'read-only query pack must count only refunds linked to trusted-principal-authorized debits')
  assert(queryPack.includes("d.metadata->>'trusted_principal_debit_amount'"), 'read-only query pack must require trusted-principal debit amount evidence for refund restoration')
  assert(queryPack.includes('sum(least(refund_amount, debit_amount))'), 'read-only query pack must cap linked refunds by each original debit amount')
  assert(queryPack.includes('trusted_consumed_spend'), 'read-only query pack must report trusted consumed spend')
  assert(queryPack.includes("metadata->>'verified_amount_ngn'"), 'read-only query pack must require provider-verified amount metadata')
  assert(queryPack.includes('from public.pending_payments pp'), 'read-only query pack must require pending payment evidence for Ercas deposits')
  assert(queryPack.includes("lower(coalesce(pp.status, 'pending')) = 'credited'"), 'read-only query pack must not count merely pending Ercas payment evidence as trusted principal')
  assert(queryPack.includes('from public.pocketfi_webhook_logs pwl'), 'read-only query pack must require PocketFi webhook evidence')
  assert(queryPack.includes('pwl.matched_user_id = t.user_id'), 'read-only query pack must bind PocketFi webhook evidence to the credited user')
  assert(queryPack.includes('coalesce(pwl.processed, false) = true'), 'read-only query pack must require processed PocketFi webhook evidence')
  assert(queryPack.includes('round(coalesce(pwl.verified_amount_ngn, -1), 2) = round(t.amount, 2)'), 'read-only query pack must require matching PocketFi verified amount evidence')
  assert(queryPack.includes('pwl.verified_reference'), 'read-only query pack must require matching PocketFi verified reference evidence')
  assert(queryPack.includes("t.type = 'admin_credit'"), 'read-only query pack must only count approved admin_credit business principal')
  assert(queryPack.includes('where coalesce(is_admin, false) = true'), 'read-only query pack must require admin actor evidence for admin_credit principal')
  assert(queryPack.includes("coalesce(t.metadata->>'approved_by', '') = t.created_by::text"), 'read-only query pack must require approved_by metadata for admin_credit principal')
  assert(queryPack.includes("coalesce(t.metadata->>'approval_reference', '')"), 'read-only query pack must require approval_reference metadata for admin_credit principal')
  assert(queryPack.includes("coalesce(t.metadata->>'reason', '')"), 'read-only query pack must require reason metadata for admin_credit principal')
  assert(queryPack.includes('coalesce(t.balance_after, 0) > coalesce(t.balance_before, 0)'), 'read-only query pack must require admin_credit to increase balance before trusting it')
  assert(queryPack.includes("t.metadata->>'source', '') <> 'admin-ledger-repair'"), 'read-only query pack must exclude admin ledger repair rows from trusted principal')
  assert(queryPack.includes('Failed/cancelled/refunded product orders that still have posted purchase'), 'read-only query pack must expose failed/refunded product orders with posted debits')
  assert(queryPack.includes('Failed/cancelled/refunded SMM orders with posted purchase debits'), 'read-only query pack must expose failed/refunded SMM orders with posted debits')
  assert(queryPack.includes('Failed/cancelled/refunded SMS orders with posted purchase debits'), 'read-only query pack must expose failed/refunded SMS orders with posted debits')
  assert(queryPack.includes('unresolved_debit_amount'), 'read-only query pack must report unresolved debit exposure for failed/refunded rows')
  assert(queryPack.includes('Evidence-erasing cascade checks. Expected: zero rows'), 'read-only query pack must expose evidence-erasing cascade checks')
  assert(queryPack.includes("con.confdeltype = 'c'"), 'read-only query pack must inspect cascading foreign keys')
  assert(queryPack.includes("refnsp.nspname = 'auth' and refrel.relname = 'users'"), 'read-only query pack must check auth.users cascades')
  assert(queryPack.includes('api_partner_webhook_deliveries'), 'read-only query pack must check partner/API evidence cascades')
  assert(queryPack.includes('Reserve-first order authorization columns. Expected: zero rows'), 'read-only query pack must expose reserve-first order authorization column checks')
  assert(queryPack.includes('wallet_reservation_id'), 'read-only query pack must check order wallet_reservation_id columns')
  assert(queryPack.includes('fulfillment_outbox_id'), 'read-only query pack must check order fulfillment_outbox_id columns')
  assert(queryPack.includes('financial_authorization_status_check'), 'read-only query pack must check order financial authorization status constraints')
  assert(queryPack.includes("idx_' || t.table_name || '_wallet_reservation_id"), 'read-only query pack must check wallet-reservation indexes')
  assert(queryPack.includes("idx_' || t.table_name || '_fulfillment_outbox_id"), 'read-only query pack must check fulfillment-outbox indexes')
  assert(!queryPack.includes("type = 'referral_withdrawal'"), 'read-only query pack must not count referral withdrawals as trusted principal')
  assert(!queryPack.includes("'deposit', 'credit'"), 'read-only query pack must not count generic credit as trusted principal')

  const mutationPattern = /\.(insert|update|upsert|delete|rpc)\s*\(/
  assert(!mutationPattern.test(script), 'read-only reconciliation command must not call Supabase mutation/RPC methods')
})

check('local wallet security suite runs available checks and records external gaps', () => {
  const script = read('scripts/wallet-local-security-suite.mjs')
  const denoEdgeScript = read('scripts/wallet-deno-edge-check.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:local": "node scripts/wallet-local-security-suite.mjs"'), 'package script must expose local wallet security suite')
  assert(pkg.includes('"security:wallet:deno-edge": "node scripts/wallet-deno-edge-check.mjs"'), 'package script must expose all-function Deno Edge Function check')
  const walletScripts = readdirSync(join(root, 'scripts'))
    .filter((name) => /^wallet-.*\.mjs$/.test(name))
    .filter((name) => name !== 'wallet-local-security-suite.mjs')
    .sort()
    .map((name) => `scripts/${name}`)

  for (const command of ['scripts/security-wallet-check.mjs', ...walletScripts]) {
    assert(script.includes(command), `local suite must run ${command}`)
  }
  assert(script.includes('scripts/wallet-deno-edge-check.mjs'), 'local suite must run the all-function Deno Edge Function check')
  assert(script.includes('process.argv.includes(\'--compact\')'), 'local suite must support compact output for complete local-suite evidence')
  assert(script.includes('resolvePackageWalletScriptCoverage'), 'local suite must dynamically compare package wallet scripts to suite coverage')
  assert(script.includes('missingFromLocalSuite'), 'local suite must report package wallet scripts missing from the local run')
  assert(script.includes('package wallet security script(s) are not covered'), 'local suite must fail loudly when package wallet scripts are not represented')
  assert(script.includes('TALLYSTORE_WALLET_LOCAL_CHECK_TIMEOUT_MS'), 'local suite must allow bounded per-check timeouts')
  assert(script.includes('TALLYSTORE_WALLET_TOOL_PROBE_TIMEOUT_MS'), 'local suite must allow bounded tool-probe timeouts')
  assert(script.includes('timedOut'), 'local suite must report timed-out child checks explicitly')
  assert(script.includes('timed out after'), 'local suite must include a clear timeout failure reason')
  assert(denoEdgeScript.includes("'--no-lock'"), 'Deno Edge Function check must avoid creating repo lockfile churn')
  assert(denoEdgeScript.includes("readdirSync(join(root, 'supabase/functions')"), 'Deno Edge Function check must discover every local function directory')
  assert(denoEdgeScript.includes("existsSync(join(root, path))"), 'Deno Edge Function check must include every function with an index.ts entrypoint')
  assert(denoEdgeScript.includes('every local Supabase Edge Function entrypoint'), 'Deno Edge Function checker must state its all-function scope')
  for (const tool of ['docker', 'psql', 'deno', 'supabase']) {
    assert(script.includes(`'${tool}'`), `local suite must probe ${tool}`)
  }
  assert(script.includes('local suite uses npx fallback for all Edge Function type checks'), 'local suite must document npx Deno fallback boundary')
  assert(script.includes('externalGaps'), 'local suite must report unavailable external tooling')
  assert(script.includes('repository-local static/model/mock checks only'), 'local suite must state local proof boundary')
  assert(script.includes('does not execute Supabase migrations'), 'local suite must not overclaim DB execution')
  assert(script.includes('Routes must remain paused until the owner completes'), 'local suite must preserve reopening boundary')
})

check('staging database concurrency runner requires guarded real psql proof', () => {
  const runner = read('scripts/wallet-db-concurrency-runner.mjs')
  const pkg = read('package.json')
  const localSuite = read('scripts/wallet-local-security-suite.mjs')
  const checklist = read('docs/security/wallet-owner-verification-checklist.md')
  const testReport = read('docs/security/wallet-test-report.md')
  const evidenceRegister = read('docs/security/wallet-production-evidence-register.md')

  assert(pkg.includes('"security:wallet:db-concurrency": "node scripts/wallet-db-concurrency-runner.mjs"'), 'package script must expose guarded DB concurrency runner')
  assert(localSuite.includes("['node', ['scripts/wallet-db-concurrency-runner.mjs', '--help']"), 'local suite must exercise DB concurrency runner help without touching a database')
  assert(localSuite.includes("['node', ['scripts/wallet-db-concurrency-runner.mjs', '--self-test']"), 'local suite must exercise DB concurrency runner self-test without touching a database')
  assert(runner.includes('TALLYSTORE_DB_CONCURRENCY_ACK'), 'DB concurrency runner must require a separate committed-mutation acknowledgement')
  assert(runner.includes('I_UNDERSTAND_COMMITTED_TEST_WALLET_MUTATIONS'), 'DB concurrency runner must require the exact committed-mutation acknowledgement')
  assert(runner.includes('--self-test'), 'DB concurrency runner must expose a no-database self-test')
  assert(runner.includes('realConcurrencyStillRequiresPsql'), 'DB concurrency runner self-test must not pretend to run real locks')
  assert(runner.includes('sanitizeOutputWithUrl'), 'DB concurrency runner must have testable database URL redaction')
  assert(runner.includes('SQL literal helper must escape single quotes'), 'DB concurrency runner self-test must cover SQL literal escaping')
  assert(runner.includes('setup SQL must seed server-owned pending payment evidence'), 'DB concurrency runner self-test must inspect setup SQL content')
  assert(runner.includes('purchase race SQL must post a purchase through the wallet engine'), 'DB concurrency runner self-test must inspect purchase race SQL content')
  assert(runner.includes('refund race SQL must link to the original order identity'), 'DB concurrency runner self-test must inspect refund race SQL content')
  assert(runner.includes('freeze durability SQL must assert the unbacked-funds denial code'), 'DB concurrency runner self-test must inspect freeze durability SQL content')
  assert(runner.includes('provider verification SQL must assert one shared provider credit'), 'DB concurrency runner self-test must inspect provider identity race SQL content')
  assert(runner.includes('cleanup SQL must remove runner ledger and pending-payment fixtures'), 'DB concurrency runner self-test must inspect cleanup SQL content')
  assert(runner.includes('TALLYSTORE_DB_TEST_ENV'), 'DB concurrency runner must require an explicit non-production test environment')
  assert(runner.includes("['local', 'staging', 'owner-controlled']"), 'DB concurrency runner must refuse production-like environment names')
  assert(runner.includes('TALLYSTORE_DB_TEST_USER_ID'), 'DB concurrency runner must require an owner-controlled ordinary test user')
  assert(runner.includes('TALLYSTORE_DB_SECOND_TEST_USER_ID'), 'DB concurrency runner must support a second ordinary fixture for cross-wallet provider races')
  assert(runner.includes('COALESCE(v_profile.is_admin, false) OR COALESCE(v_profile.is_staff, false)'), 'DB concurrency runner must reject admin/staff fixture accounts')
  assert(runner.includes('psql'), 'DB concurrency runner must use real psql sessions')
  assert(runner.includes('runConcurrent'), 'DB concurrency runner must actually launch concurrent psql sessions')
  assert(runner.includes('public.apply_wallet_transaction'), 'DB concurrency runner must exercise the real wallet transaction engine')
  assert(runner.includes("'topup'"), 'DB concurrency runner must seed a verified topup through the wallet engine')
  assert(runner.includes("'purchase'"), 'DB concurrency runner must test purchase posting through the wallet engine')
  assert(runner.includes("'refund'"), 'DB concurrency runner must test refund posting through the wallet engine')
  assert(runner.includes('source_order_id'), 'DB concurrency runner refunds must target the winning purchase by source-order linkage')
  assert(runner.includes('expected exactly one purchase'), 'DB concurrency runner must assert over-total purchase races commit at most one debit')
  assert(runner.includes('expected exactly one refund'), 'DB concurrency runner must assert duplicate refund races commit at most one refund')
  assert(runner.includes('provider_identity'), 'DB concurrency runner must test duplicate provider identity races when a second fixture is supplied')
  assert(runner.includes('expected one shared provider payment credit'), 'DB concurrency runner must assert one provider identity cannot fund two wallets')
  assert(runner.includes('expected one consumed shared pending payment'), 'DB concurrency runner must assert only one provider evidence row is consumed')
  assert(runner.includes('expected combined wallet balance 500 after shared provider race'), 'DB concurrency runner must verify the cross-wallet provider race final balances')
  assert(runner.includes('freeze_durability'), 'DB concurrency runner must test durable unbacked-purchase freeze behavior')
  assert(runner.includes('expected WALLET_UNBACKED_FUNDS freeze denial'), 'DB concurrency runner must require the unbacked freeze denial code')
  assert(runner.includes('unbacked purchase denial did not durably freeze wallet'), 'DB concurrency runner must verify the freeze state remains after the function returns')
  assert(runner.includes('denied unbacked purchase inserted'), 'DB concurrency runner must verify denied unbacked purchases do not insert purchase ledgers')
  assert(runner.includes('expected wallet balance 300 after purchase race'), 'DB concurrency runner must verify final wallet state after purchase race')
  assert(runner.includes('expected wallet balance 1000 after refund race'), 'DB concurrency runner must verify final wallet state after refund race')
  assert(runner.includes('cleanup-after-failure'), 'DB concurrency runner must attempt cleanup after failures')
  assert(runner.includes('resets the supplied test wallet(s) to zero'), 'DB concurrency runner help must disclose fixture reset behavior')
  assert(checklist.includes('security:wallet:db-concurrency'), 'owner checklist must include DB concurrency runner command')
  assert(testReport.includes('security:wallet:db-concurrency -- --help'), 'test report must record DB concurrency runner help proof')
  assert(evidenceRegister.includes('Real DB concurrency proof'), 'production evidence register must track real DB concurrency proof')
})

check('production evidence register is machine-checked', () => {
  const script = read('scripts/wallet-production-evidence-check.mjs')
  const pkg = read('package.json')
  const localSuite = read('scripts/wallet-local-security-suite.mjs')

  assert(pkg.includes('"security:wallet:evidence": "node scripts/wallet-production-evidence-check.mjs"'), 'package script must expose production evidence check')
  assert(localSuite.includes('scripts/wallet-production-evidence-check.mjs'), 'local wallet suite must run production evidence check')
  assert(localSuite.includes("['node', ['scripts/wallet-production-evidence-check.mjs', '--filled-template']"), 'local wallet suite must render the fillable production evidence file')
  assert(localSuite.includes("['node', ['scripts/wallet-production-evidence-check.mjs', '--self-test']"), 'local wallet suite must run production evidence validator self-test')

  for (const needle of [
    'parseArgs',
    'filled-template',
    'validateProductionEvidenceFile',
    'validateProductionEvidenceObject',
    'buildFilledEvidenceTemplate',
    'evidenceLabels',
    'standardFields',
    'runSelfTest',
    'failureBranchesChecked',
    'productionEvidenceTemplateValidator',
    'productionAreas',
    'outcomeStates',
    'providerCapabilities',
    'reopeningFields',
    'stagingEvidenceFields',
    'AREA_NOT_PASSED',
    'AREA_MISSING',
    'DUPLICATE_AREA',
    'UNKNOWN_AREA',
    'INVALID_VERIFIED_AT',
    'SECRET_LIKE_VALUE',
    'productionEvidenceLinkOrPath',
    'status must be passed, pending, blocked, or failed',
    'status: \'passed\'',
    'No route should move from paused to active without this entry filled in',
    'Do not run it against a real customer',
    'Do not blindly retry the supplier',
    'Any missing route must be treated as `UNKNOWN`',
  ]) {
    assert(script.includes(needle), `production evidence checker missing ${needle}`)
  }
})

check('incident completion audit covers prompt deliverables and proof boundaries', () => {
  const script = read('scripts/wallet-incident-completion-audit.mjs')
  const pkg = read('package.json')
  const localSuite = read('scripts/wallet-local-security-suite.mjs')
  const testReport = read('docs/security/wallet-test-report.md')
  const checklist = read('docs/security/wallet-owner-verification-checklist.md')
  const manifest = read('docs/security/wallet-deployment-manifest.md')
  const finalReport = read('docs/security/wallet-incident-final-report.md')
  const mutationMap = read('docs/security/wallet-mutation-map.md')
  const fulfillmentMap = read('docs/security/wallet-fulfillment-map.md')

  assert(pkg.includes('"security:wallet:audit": "node scripts/wallet-incident-completion-audit.mjs"'), 'package script must expose incident completion audit')
  assert(localSuite.includes('scripts/wallet-incident-completion-audit.mjs'), 'local wallet suite must run incident completion audit')

  for (const needle of [
    'requiredArtifacts',
    'b15ReportRequirements',
    'promptDeliverableTerms',
    'evidenceLabels',
    'ownerBoundaryPhrases',
    'parseRegressionRows',
    'pendingStatusLabels',
    'pendingRegressionProofRows',
    'regressionRowsChecked: 80',
    'the matrix is not fully green',
    'suspension decision matrix and recovery workflow',
    'wallet-mutation-map.md',
    'wallet-fulfillment-map.md',
    'wallet-financial-model.md',
    'wallet-state-machine.md',
    'wallet-production-evidence-register.md',
    'PRODUCTION_VERIFICATION_PENDING_OWNER',
    'HISTORICAL_CAUSE_UNPROVEN',
  ]) {
    assert(script.includes(needle), `incident completion audit missing ${needle}`)
  }

  for (const retiredLabel of [
    'LOCAL_CONCURRENCY_TESTS_PENDING',
    'PROVIDER_SANDBOX_TESTS_PENDING',
    'PROVIDER_OUTCOME_TESTS_PENDING',
    'PRODUCTION_EVIDENCE_PENDING_OWNER',
    'STAGING_PROVIDER_CONCURRENCY_TESTS_PENDING',
    'PRODUCTION_EVIDENCE_COLLECTION_PENDING_OWNER',
  ]) {
    assert(!testReport.includes(retiredLabel), `test report still uses retired proof label ${retiredLabel}`)
  }

  for (const needle of [
    'npx tsc --noEmit --pretty false',
    'TypeScript compile check completed without errors',
    'npm run build',
    'Vite production build completed',
    'npm run lint',
    '0 errors and 25 existing warnings',
    'npm run security:wallet:deno-edge',
    'all 37 local Supabase Edge Function entrypoints',
    'npm run security:wallet:source-mutations',
    'scanned 214 server/frontend function files',
    'npm run security:wallet:migrations',
    '37 incident migrations',
  ]) {
    assert(testReport.includes(needle), `test report missing broad local verification evidence: ${needle}`)
  }

  for (const needle of [
    'Required Field Coverage',
    'External or internal caller',
    'Source-of-funds validation',
    'Production evidence still needed',
  ]) {
    assert(mutationMap.includes(needle), `mutation map missing prompt field coverage ${needle}`)
  }

  for (const needle of [
    'Price source',
    'Order creation location',
    'Financial authorization function',
    'Reservation/capture location',
    'Supplier adapter or inventory source',
    'First irreversible action',
    'Retry, cancellation, or refund path',
    'Coverage test',
  ]) {
    assert(fulfillmentMap.includes(needle), `fulfillment map missing prompt field coverage ${needle}`)
  }

  for (const doc of [testReport, checklist, manifest, finalReport]) {
    assert(doc.includes('security:wallet:audit'), 'incident docs must mention the completion audit command')
  }
})

check('owner handoff verifier preserves production proof boundaries', () => {
  const script = read('scripts/wallet-owner-handoff-check.mjs')
  const checklist = read('docs/security/wallet-owner-verification-checklist.md')
  const containment = read('docs/security/wallet-incident-containment.md')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:handoff": "node scripts/wallet-owner-handoff-check.mjs"'), 'package script must expose owner handoff check')
  for (const needle of [
    'PRODUCTION_DEPLOYMENT_PENDING',
    'PRODUCTION_VERIFICATION_PENDING_OWNER',
    'HISTORICAL_CAUSE_UNPROVEN',
    'requiredOwnerChecks',
    'requiredPausedSurfaces',
    'requiredEvidenceRegisterFields',
    'requiredStateMachinePhrases',
    'Wallet state machine and review workflow',
    'Do not reopen a paused paid route',
    'wallet-production-evidence-register.md',
    'wallet-state-machine.md',
  ]) {
    assert(script.includes(needle), `owner handoff checker missing ${needle}`)
  }
  assert(checklist.includes('89 passing'), 'owner checklist must reflect current 89-check wallet guard')
  assert(containment.includes('reports 89 passing checks'), 'containment report must reflect current 89-check wallet guard')
  assert(includesPhrase(containment, '32 currently changed function entrypoints'), 'containment report must reflect current deployment manifest function count')
  assert(containment.includes('passed 50 repository-local checks'), 'containment report must reflect current local security suite count')
  assert(containment.includes('validation-shaped fillable evidence file'), 'containment report must mention provider fillable evidence file coverage')
  assert(containment.includes('provider-evidence validator self-test'), 'containment report must mention provider evidence validator coverage')
  assert(containment.includes('all 37 local Edge Functions'), 'containment report must mention all-function Deno Edge Function type check')
  for (const fn of [
    'admin-adjust-balance',
    'apply-referral',
    'auto-restock',
    'check-pending-payments',
    'create-crypto-sell-order',
    'create-pocketfi-topup',
    'create-wallet-topup',
    'create-withdrawal-request',
    'manage-staff',
    'manual-restock',
    'muabanvia-fulfill',
    'nowpayments-webhook',
    'partner-api',
    'process-purchase',
    'purchase-bills',
    'purchase-bitrefill',
    'record-site-visit',
    'revenue-os-loop',
    'revenue-os-maintenance',
    'smm-check-all-orders',
    'smm-check-status',
    'smm-create-order',
    'smsbus',
    'telegram-stars',
    'verify-and-credit-wallet',
    'webhook-pocketfi',
    'withdraw-referral-balance',
  ]) {
    assert(containment.includes(fn), `containment deployment order missing ${fn}`)
  }
  assert(!checklist.includes('79 passing'), 'owner checklist has stale wallet check count')
  assert(!containment.includes('reports 79 passing checks'), 'containment report has stale wallet check count')
  assert(!containment.includes('25 changed Supabase functions'), 'containment report has stale changed-function count')
  assert(!containment.includes('passed 22'), 'containment report has stale local security-suite count')
  assert(includesPhrase(containment, '16 Vercel/site surfaces, and 11 required pause flags'), 'containment report must reflect current deployment manifest pause-flag count')
})

check('deployment manifest covers migrations, functions, app routes, and pause flags', () => {
  const manifest = read('docs/security/wallet-deployment-manifest.md')
  const script = read('scripts/wallet-deployment-manifest-check.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:deploy-manifest": "node scripts/wallet-deployment-manifest-check.mjs"'), 'package script must expose deployment manifest check')
  assert(script.includes('changedFunctions'), 'deployment manifest checker must enumerate changed functions')
  assert(script.includes('outputPlan'), 'deployment manifest checker must expose a machine-readable plan mode')
  assert(script.includes('buildDeploymentPlan'), 'deployment manifest checker must build the deployment plan')
  assert(script.includes('validateDeploymentPlanFile'), 'deployment manifest checker must validate saved deployment-plan evidence')
  assert(script.includes('validateDeploymentPlanObject'), 'deployment manifest checker must validate deployment-plan contents')
  assert(script.includes('--validate-plan'), 'deployment manifest checker must expose saved-plan validation mode')
  assert(script.includes('--self-test'), 'deployment manifest checker must expose a no-network self-test')
  assert(script.includes('SECRET_LIKE_VALUE'), 'deployment manifest checker must reject secret-looking values in deployment plans')
  assert(script.includes('manifestDeployFunctionNames'), 'deployment manifest checker must parse function deploy commands from the manifest')
  assert(script.includes('deployCommands'), 'deployment manifest checker must emit function deploy commands')
  assert(script.includes('postDeployProofFields'), 'deployment manifest checker must emit post-deploy proof fields')
  assert(script.includes('requiredMigrations'), 'deployment manifest checker must enumerate required migrations')
  assert(script.includes('vercelSurfaces'), 'deployment manifest checker must enumerate Vercel/site surfaces')
  assert(script.includes('pauseFlags'), 'deployment manifest checker must enumerate pause flags')

  for (const needle of [
    'supabase db push',
    'supabase functions deploy partner-api',
    'supabase functions deploy verify-and-credit-wallet',
    'supabase functions deploy webhook-pocketfi',
    'supabase functions deploy chatbot',
    'supabase functions deploy email',
    'supabase functions deploy get-data-plans',
    'supabase functions deploy smm-get-services',
    'supabase functions deploy smm-sync-services',
    'api/partner-api.ts',
    'api/webhook-pocketfi.ts',
    '20260919001000_enforce_backed_wallet_purchases.sql',
    '20260919013000_enforce_wallet_money_bounds.sql',
    'BILLS_ENABLED=false',
    'SMM_ORDERS_ENABLED=false',
    'SMS_OTP_ENABLED=false',
    'TELEGRAM_ORDERS_ENABLED=false',
    'LIVE_ACCOUNT_FULFILLMENT_ENABLED=false',
    'Do not reopen any paused route',
    'Rollback rule',
  ]) {
    assert(manifest.includes(needle), `deployment manifest missing ${needle}`)
  }

  assert(manifest.includes('reports 89 checks passing'), 'deployment manifest must describe the current 89-check wallet guard')
  assert(!manifest.includes('reports 73 checks'), 'deployment manifest has stale wallet check count')
  assert(!manifest.includes('reports 74 checks'), 'deployment manifest has stale wallet check count')
})

check('incident migration safety tests cover grants, function exposure, and search paths', () => {
  const script = read('scripts/wallet-migration-safety-test.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:migrations": "node scripts/wallet-migration-safety-test.mjs"'), 'package script must expose migration safety tests')
  assert(script.includes('202609(?:17|19)'), 'migration test must target incident migration set')
  assert(script.includes('20260914007000_fix_security_definer_public_views.sql'), 'migration test must include the patched security-definer public view migration')
  assert(script.includes('protectedTables'), 'migration test must enumerate protected tables')
  assert(script.includes('stripDollarQuotedBodies'), 'migration test must inspect top-level SQL outside function bodies')
  assert(script.includes('topLevelStatements'), 'migration test must build top-level migration statements')
  assert(script.includes('performs a top-level profile balance update during migration execution'), 'migration test must reject unsafe deployment-time profile balance writes')
  assert(script.includes('inserts transaction ledger rows during migration execution'), 'migration test must reject deployment-time ledger inserts')
  assert(script.includes('safeNullNormalization'), 'migration test must allow only explicit null-to-zero balance normalization')
  assert(script.includes('no browser write grants'), 'migration test must reject browser writes to protected tables')
  assert(script.includes('no browser EXECUTE grants'), 'migration test must reject browser function execution grants')
  assert(script.includes('DISABLE\\s+ROW\\s+LEVEL\\s+SECURITY'), 'migration test must reject RLS disablement')
  assert(script.includes('SET\\s+search_path\\s*=\\s*public'), 'migration test must enforce definer search_path pinning')
  assert(script.includes('standalone transaction control inside a SQL function body'), 'migration test must reject transaction control inside SQL function bodies')
  assert(script.includes('START\\s+TRANSACTION'), 'migration test must detect explicit transaction-start statements inside function bodies')
  assert(script.includes('ALTER DEFAULT PRIVILEGES IN SCHEMA public'), 'migration test must require default execute hardening')
  assert(script.includes('REVOKE ALL ON FUNCTION public.apply_wallet_transaction'), 'migration test must require wallet engine revoke')
  assert(script.includes('CREATE TRIGGER trg_guard_transaction_ledger_authority'), 'migration test must require ledger authority trigger')
  assert(script.includes('CREATE TRIGGER guard_profile_privileged_fields_insert'), 'migration test must require profile privileged insert trigger')
  assert(script.includes('wallet_security_events'), 'migration test must protect wallet security events')

  const docs = [
    read('docs/security/wallet-deployment-manifest.md'),
    read('docs/security/wallet-owner-verification-checklist.md'),
    read('docs/security/wallet-test-report.md'),
    read('docs/security/wallet-regression-matrix.md'),
  ].join('\n')
  assert(docs.includes('37 incident migrations'), 'security docs must describe the 37-migration safety scope')
  assert(!docs.includes('34 incident migrations'), 'security docs must not describe the stale 34-migration safety scope')
  assert(!docs.includes('33 incident migrations'), 'security docs must not describe the stale 33-migration safety scope')
  assert(!docs.includes('32 incident migrations'), 'security docs must not describe the stale 32-migration safety scope')
  assert(!docs.includes('31 incident migrations'), 'security docs must not describe the stale 31-migration safety scope')
  assert(!docs.includes('29 incident migrations'), 'security docs must not describe the stale 29-migration safety scope')
  assert(!docs.includes('28 incident migrations'), 'security docs must not describe the stale 28-migration safety scope')
  assert(!docs.includes('27 incident migrations'), 'security docs must not describe the stale 27-migration safety scope')
  assert(!docs.includes('26 incident migrations'), 'security docs must not describe the stale 26-migration safety scope')
  assert(!docs.includes('25 incident migrations'), 'security docs must not describe the stale 25-migration safety scope')
  assert(!docs.includes('24 incident migrations'), 'security docs must not describe the stale 24-migration safety scope')
})

check('wallet security events provide a restricted forensic sink', () => {
  const migration = read('supabase/migrations/20260919017000_create_wallet_security_events.sql')
  const captureMigration = read('supabase/migrations/20260919018000_capture_wallet_security_events.sql')
  const walletEngine = read('supabase/migrations/20260919001000_enforce_backed_wallet_purchases.sql')
  const docs = [
    read('docs/security/wallet-incident-final-report.md'),
    read('docs/security/wallet-production-evidence-register.md'),
    read('docs/security/wallet-owner-verification-checklist.md'),
  ].join('\n')
  const adminPage = read('src/pages/AdminPage.tsx')

  for (const needle of [
    'CREATE TABLE IF NOT EXISTS public.wallet_security_events',
    'ALTER TABLE public.wallet_security_events ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON public.wallet_security_events FROM anon',
    'REVOKE ALL ON public.wallet_security_events FROM authenticated',
    'GRANT SELECT, INSERT ON public.wallet_security_events TO service_role',
    'CREATE POLICY "Admins can read wallet security events"',
    'CREATE POLICY "Service role can read wallet security events"',
    'CREATE POLICY "Service role can insert wallet security events"',
    'CREATE OR REPLACE FUNCTION public.record_wallet_security_event',
    'SECURITY DEFINER',
    'SET search_path = public',
    'REVOKE ALL ON FUNCTION public.record_wallet_security_event',
    'GRANT EXECUTE ON FUNCTION public.record_wallet_security_event',
    'request_id',
    'idempotency_key',
    'ip_address',
    'user_agent',
    'device_fingerprint',
    'financial_snapshot',
    'denial_code',
    'This function never creates spendable value',
  ]) {
    assert(migration.includes(needle), `wallet security event migration missing ${needle}`)
  }

  assert(!/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[^;]*wallet_security_events[^;]*(?:anon|authenticated)/i.test(migration), 'browser roles must not write wallet_security_events')
  assert(!/FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(migration), 'wallet_security_events must not force RLS against the definer-based event writer')
  assert(walletEngine.includes("set_config('app.tally_request_forensics'"), 'wallet engine must carry request forensics into freeze triggers')
  assert(walletEngine.includes("COALESCE((p_metadata->'request_forensics')::text, '{}')"), 'wallet engine must source freeze forensics from wallet metadata')
  assert(walletEngine.includes("set_config('app.tally_request_forensics', '{}', true)"), 'wallet engine must clear transaction-local request forensics after freeze updates')

  for (const needle of [
    'CREATE OR REPLACE FUNCTION public.capture_transaction_ledger_blocked_event',
    'CREATE TRIGGER trg_capture_transaction_ledger_blocked_event',
    'CREATE OR REPLACE FUNCTION public.capture_profile_balance_blocked_event',
    'CREATE TRIGGER trg_capture_profile_balance_blocked_event',
    'CREATE OR REPLACE FUNCTION public.capture_profile_financial_freeze_event',
    'CREATE TRIGGER trg_capture_profile_financial_freeze_event',
    'DIRECT_LEDGER_WRITE_BLOCKED',
    'PROFILE_BALANCE_WRITE_BLOCKED',
    'WALLET_FINANCIAL_FREEZE',
    'WALLET_UNBACKED_FUNDS',
    'WALLET_DEBT_REVIEW_REQUIRED',
    'AUTO_LEDGER_REVIEW_REQUIRED',
    'record_wallet_security_event',
    "current_setting('app.tally_request_forensics', true)",
    "request_forensics->>'route'",
    "request_forensics->>'request_id'",
    "request_forensics->>'ip_address'",
    "request_forensics->>'user_agent'",
    "request_forensics->>'device_fingerprint'",
    'user_agent_hash',
    'cf_ray',
    'vercel_id',
  ]) {
    assert(captureMigration.includes(needle), `wallet security event capture migration missing ${needle}`)
  }

  for (const needle of [
    'wallet_security_events',
    'record_wallet_security_event',
    'request ID, actor, IP/device context, old/new financial values, B/H/A evidence, result, and denial code',
  ]) {
    assert(docs.includes(needle), `security docs missing forensic event detail: ${needle}`)
  }

  for (const needle of [
    "from('wallet_security_events'",
    'userSecurityEvents',
    'Security Events',
    'See all ${userSecurityEvents.length} security events',
    'security_event',
  ]) {
    assert(adminPage.includes(needle), `Admin user details missing wallet security event UI/query detail: ${needle}`)
  }
})

check('provider adapter mock tests cover no-network dispatch boundaries', () => {
  const script = read('scripts/wallet-provider-adapter-test.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:adapters": "node scripts/wallet-provider-adapter-test.mjs"'), 'package script must expose provider adapter mock tests')
  for (const route of [
    'smm-panel',
    'daisysms',
    'istar',
    'bitrefill',
    'sagecloud-bills',
    'sagecloud-withdrawal',
  ]) {
    assert(script.includes(`'${route}'`), `adapter test must cover ${route}`)
  }
  assert(script.includes('MockProviderAdapter'), 'adapter test must use mock providers')
  assert(script.includes('outboundNetworkCalls: 0'), 'adapter test must assert no outbound network calls')
  assert(script.includes('paused route called provider'), 'adapter test must block paused route dispatch')
  assert(script.includes('frozen wallet called provider'), 'adapter test must block frozen wallet dispatch')
  assert(script.includes('insufficient wallet called provider'), 'adapter test must block insufficient-funds dispatch')
  assert(script.includes('unavailable financial state called provider'), 'adapter test must block provider dispatch when financial state is unavailable')
  assert(script.includes('FINANCIAL_STATE_UNAVAILABLE'), 'adapter test must model unavailable financial state')
  assert(script.includes('successful purchase did not call provider exactly once'), 'adapter test must assert one provider call on success')
  assert(script.includes('exact replay called provider again'), 'adapter test must block duplicate dispatch on idempotent replay')
  assert(script.includes('changed idempotency payload called provider'), 'adapter test must block changed idempotency payload dispatch')
  assert(script.includes('timeout created blind refund'), 'adapter test must preserve unknown outcomes without blind refunds')
  assert(script.includes('duplicate failure refund double-credited'), 'adapter test must prove failed callbacks refund once')
  assert(script.includes('provider failure refund did not reference the original debit'), 'adapter test must prove provider-failure refunds carry original debit provenance')
  assert(script.includes('naked provider refund was allowed'), 'adapter test must reject provider refunds without original debit provenance')
})

check('wallet model generated sequence tests cover core accounting invariants', () => {
  const script = read('scripts/wallet-model-sequence-test.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:model": "node scripts/wallet-model-sequence-test.mjs"'), 'package script must expose wallet model sequence tests')
  assert(script.includes('SEQUENCE_COUNT = 400'), 'model test must run many deterministic generated sequences')
  assert(script.includes('STEPS_PER_SEQUENCE = 160'), 'model test must run long generated sequences')
  assert(script.includes('REFUND_EXCEEDS_TRUSTED_ORIGINAL_DEBIT'), 'model test must reject over-refunds')
  assert(script.includes('trustedPrincipal'), 'model test must track trusted principal separately from displayed balance')
  assert(script.includes('reserved'), 'model test must track reserved spend separately from book balance')
  assert(script.includes('capture_reservation'), 'model test must cover capture of reserved funds')
  assert(script.includes('valid reservations reduce trusted available without creating fake-balance fraud'), 'model test must prove valid reservations do not create false fraud')
  assert(script.includes('fake_balance'), 'model test must cover fake displayed wallet balance')
  assert(script.includes('internal_movement'), 'model test must cover internal non-principal balance movement')
  assert(script.includes('legacy_unbacked_debit'), 'model test must cover refunds of unbacked legacy debits')
  assert(script.includes('WALLET_UNBACKED_FUNDS'), 'model test must block unbacked product spend')
  assert(script.includes('IDEMPOTENCY_CONFLICT'), 'model test must reject changed idempotency payloads')
  assert(script.includes('IDEMPOTENT_REPLAY'), 'model test must prove duplicate replay does not double apply')
  assert(script.includes('WALLET_FROZEN'), 'model test must block outgoing purchases while frozen')
  assert(script.includes('INSUFFICIENT_FUNDS'), 'model test must keep ordinary insufficient funds separate from fraud')
  assert(script.includes('frozen wallet blocked incoming verified credit'), 'model test must preserve incoming funds while frozen')
})

check('wallet concurrency decision tests cover local race outcomes', () => {
  const script = read('scripts/wallet-concurrency-decision-test.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:concurrency": "node scripts/wallet-concurrency-decision-test.mjs"'), 'package script must expose wallet concurrency tests')
  assert(script.includes('withWalletLock'), 'concurrency test must model a wallet-row lock boundary')
  assert(script.includes('trustedPrincipal'), 'concurrency test must track trusted principal separately from displayed balance')
  assert(script.includes('trustedConsumedDebit'), 'concurrency test must track consumed trusted debit separately from displayed balance')
  assert(script.includes('originalDebitKey'), 'concurrency test refunds must be linked to an original trusted debit')
  assert(script.includes('REFUND_ORIGINAL_DEBIT_REQUIRED'), 'concurrency test must reject loose refunds without original debit evidence')
  assert(script.includes('REFUND_ORIGINAL_DEBIT_NOT_TRUSTED'), 'concurrency test must reject refunds linked to untrusted debit evidence')
  assert(script.includes('WALLET_UNBACKED_FUNDS'), 'concurrency test must freeze/block fake displayed balance before spend')
  assert(script.includes('simultaneousPurchasesCannotDoubleSpend'), 'concurrency test must cover simultaneous purchase double-spend')
  assert(script.includes('depositPurchaseInterleavingIsSerializable'), 'concurrency test must cover deposit/purchase interleaving')
  assert(script.includes('freezePurchaseRaceSerializes'), 'concurrency test must cover freeze/purchase races')
  assert(script.includes('duplicateRefundRaceDoesNotDoubleCredit'), 'concurrency test must cover duplicate refund races')
  assert(script.includes('looseRefundCannotCreateSpendableValue'), 'concurrency test must prove loose refunds cannot create spendable trusted value')
  assert(script.includes('transactionFaultsRollBackPartialWork'), 'concurrency test must cover rollback after partial work')
  assert(script.includes('FAULT_AFTER_LEDGER') && script.includes('FAULT_AFTER_BALANCE'), 'concurrency test must inject ledger and balance faults')
})

check('outbox decision tests cover crash recovery and worker dispatch races', () => {
  const script = read('scripts/wallet-outbox-decision-test.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:outbox": "node scripts/wallet-outbox-decision-test.mjs"'), 'package script must expose outbox decision tests')
  assert(script.includes('COMMITTED_APP_CRASHED_AFTER_COMMIT'), 'outbox test must cover app crash after commit')
  assert(script.includes('TRANSACTION_ROLLED_BACK'), 'outbox test must cover rollback before commit')
  assert(script.includes('NO_PENDING_MESSAGES'), 'outbox test must prove rolled-back work leaves no dispatch message')
  assert(script.includes('WALLET_NOT_ACTIVE'), 'outbox test must block old queue messages after freeze')
  assert(script.includes('ORDER_AUTHORIZATION_STALE'), 'outbox test must reject stale authorizations after security-version changes')
  assert(script.includes('FULFILLMENT_RESERVATION_REQUIRED'), 'outbox test must require a committed reservation before enqueue')
  assert(script.includes('OUTBOX_CLAIM_INVALID'), 'outbox test must reject dispatch by a worker without the claim')
  assert(script.includes('FULFILLMENT_DISPATCH_IDEMPOTENCY_CONFLICT'), 'outbox test must reject changed dispatch idempotency payloads')
  assert(script.includes('JSON.stringify(existingMessage.payload)'), 'outbox test must bind idempotency to dispatch payload')
  assert(script.includes('FULFILLMENT_DISPATCH_FINISHED'), 'outbox test must cover claimed-worker finish semantics')
  assert(script.includes('two workers cannot dispatch the same claimed message'), 'outbox test must prove duplicate workers cannot double-dispatch')
  assert(script.includes('only the claiming worker can finish a dispatch message'), 'outbox test must prove finish requires the claiming worker')
  assert(script.includes('model.supplierCalls.length === 0'), 'outbox test must assert denied queued work makes no supplier calls')
  assert(script.includes('model.supplierCalls.length === 1'), 'outbox test must assert recoverable queued work dispatches once')
})

check('reservation decision tests cover hold, capture, release, and refund-principal boundaries', () => {
  const script = read('scripts/wallet-reservation-decision-test.mjs')
  const pkg = read('package.json')
  const localSuite = read('scripts/wallet-local-security-suite.mjs')

  assert(pkg.includes('"security:wallet:reservations": "node scripts/wallet-reservation-decision-test.mjs"'), 'package script must expose reservation decision tests')
  assert(localSuite.includes('scripts/wallet-reservation-decision-test.mjs'), 'local suite must run reservation decision tests')
  assert(script.includes('INSUFFICIENT_TRUSTED_AVAILABLE_FUNDS'), 'reservation test must deny holds above trusted available')
  assert(script.includes('WALLET_RESERVATION_IDEMPOTENCY_CONFLICT'), 'reservation test must reject changed idempotency payloads')
  assert(script.includes('WALLET_RESERVATION_ALREADY_CAPTURED'), 'reservation test must reject releasing captured reservations')
  assert(script.includes('WALLET_RESERVATION_EXPIRED'), 'reservation test must reject expired reservation capture')
  assert(script.includes('active hold did not reduce trusted available funds'), 'reservation test must assert active holds reduce available funds')
  assert(script.includes('capture reservation through wallet engine'), 'reservation test must assert capture uses the wallet-engine purchase model')
  assert(script.includes('release does not create refund credit'), 'reservation test must prove release does not mint refund/credit money')
  assert(script.includes('refund created trusted money without a prior trusted debit'), 'reservation test must prove refunds are not a principal source')
  assert(script.includes('refund increased trusted principal instead of restoring consumed spend'), 'reservation test must prove refunds restore prior trusted debit capacity only')
})

check('route decision tests cover hostile payload, wallet authorization, and idempotency policy', () => {
  const script = read('scripts/wallet-route-decision-test.mjs')
  const runtimeBoundaryScript = read('scripts/wallet-runtime-boundary-source-test.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:routes": "node scripts/wallet-route-decision-test.mjs"'), 'package script must expose route decision tests')
  assert(pkg.includes('"security:wallet:runtime-boundaries": "node scripts/wallet-runtime-boundary-source-test.mjs"'), 'package script must expose runtime boundary source tests')
  assert(script.includes('testProductRoute'), 'route test must cover product checkout decisions')
  assert(script.includes('testSmmRoute'), 'route test must cover SMM checkout decisions')
  assert(script.includes('testSmsRoute'), 'route test must cover SMS checkout decisions')
  assert(script.includes('testTelegramRoute'), 'route test must cover Telegram checkout decisions')
  assert(script.includes('testWalletAuthorizationDecision'), 'route test must cover wallet authorization decline decisions')
  assert(script.includes('INVALID_QUANTITY'), 'route test must reject invalid quantities')
  assert(script.includes('PRICE_CHANGED'), 'route test must reject tampered client prices')
  assert(script.includes('INSUFFICIENT_FUNDS'), 'route test must keep honest insufficient funds as an ordinary decline')
  assert(script.includes('freeze === false'), 'route test must prove ordinary insufficient funds does not freeze')
  assert(script.includes('trustedBook'), 'route test must compare displayed balance to trusted book balance, not only available balance')
  assert(script.includes('reservedSpend'), 'route test must model active reservations')
  assert(script.includes('active reservation should not look like unbacked funds'), 'route test must prevent valid holds from triggering fraud freeze')
  assert(script.includes('stale client/cache balance must not authorize spend'), 'route test must ignore stale client or cached balances during authorization')
  assert(script.includes('WALLET_UNBACKED_FUNDS'), 'route test must freeze unbacked displayed balances')
  assert(script.includes('FINANCIAL_STATE_UNAVAILABLE'), 'route test must fail closed when financial state is unavailable')
  assert(script.includes('IDEMPOTENT_REPLAY'), 'route test must prove exact idempotency replay')
  assert(script.includes('IDEMPOTENCY_REQUEST_CONFLICT'), 'route test must reject changed idempotency payloads')
  assert(script.includes('server-computed amount'), 'route test must assert server-computed pricing')
  for (const needle of [
    'admin unsuspend must calculate wallet backing before changing suspension state',
    'NOWPayments webhook must verify IPN signature before creating service-role client',
    'NOWPayments crypto credit must stay held for manual review',
    'bills route must debit wallet before airtime provider dispatch',
    'Bitrefill route must debit wallet before provider dispatch',
    'order history data layer must hide credentials unless orders are completed',
    'SMM single-status worker must only status-check and wallet-engine refund with order provenance',
    'SMM all-orders worker must be cron/service authorized and only status-check/refund existing orders',
    'pending payment recovery worker must be cron/service authorized and delegate crediting to verification function',
    'verify-and-credit-wallet must bind server-created pending payment before wallet credit',
    'verify-and-credit-wallet must validate provider amount before wallet credit',
    'staff worker paths must refund through wallet engine and keep approving-admin/order provenance',
    'revenue/admin-alert logging helpers cannot dispatch suppliers, reveal value, or throw delivery-changing errors',
    'current worker-like functions cannot dispatch suppliers from stale status/recovery/admin messages',
  ]) {
    assert(runtimeBoundaryScript.includes(needle), `runtime boundary source test missing ${needle}`)
  }

  const routeSourceScript = read('scripts/wallet-route-source-order-test.mjs')
  assert(routeSourceScript.includes('product credentials require atomic reserve/capture completion'), 'route source audit must cover product reserve/capture no-delivery boundaries')
  assert(routeSourceScript.includes('SMM route must complete wallet debit before the provider client can be used'), 'route source audit must assert SMM debit failures stop before provider dispatch')
  assert(routeSourceScript.includes('SMS route must complete wallet debit before DaisySMS allocation'), 'route source audit must assert SMS debit failures stop before provider allocation')
  assert(routeSourceScript.includes('Telegram Stars must preserve debit failure evidence before any iStar dispatch path'), 'route source audit must assert Telegram Stars debit failures stop before iStar dispatch')
  assert(routeSourceScript.includes('debit-first route code does not also execute financial hold release/capture operations'), 'route source audit must prove debit-first refunds are not mixed with financial hold release/capture')
})

check('supplier outcome tests cover unknown, duplicate, and late provider states', () => {
  const script = read('scripts/wallet-supplier-outcome-test.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:suppliers": "node scripts/wallet-supplier-outcome-test.mjs"'), 'package script must expose supplier outcome tests')
  assert(script.includes('lostResponseDoesNotRetryOrRefund'), 'supplier test must cover response-lost unknown outcomes')
  assert(script.includes('lateSuccessAfterUnknownDoesNotDuplicateDispatch'), 'supplier test must cover late success after unknown outcome')
  assert(script.includes('definitiveFailureRefundsOnce'), 'supplier test must cover definitive failure refund idempotency')
  assert(script.includes('smmPartialRefundIsCappedAndIdempotent'), 'supplier test must cover capped/idempotent SMM partial refunds')
  assert(script.includes('daisyTerminalCallbacksRefundOnceAndHideCode'), 'supplier test must cover Daisy terminal failure refunds')
  assert(script.includes('daisyLateCodeAfterFailureDoesNotRefundAgain'), 'supplier test must cover late Daisy success without second refund')
  assert(script.includes('REFUND_EXCEEDS_ORDER_AMOUNT'), 'supplier test must reject supplier over-refunds')
  assert(script.includes('outcome_unknown'), 'supplier test must preserve unknown outcomes')
})

check('refund conservation tests cover partial refunds per original debit', () => {
  const script = read('scripts/wallet-refund-conservation-test.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:refunds": "node scripts/wallet-refund-conservation-test.mjs"'), 'package script must expose refund conservation tests')
  assert(script.includes('SEQUENCE_COUNT = 200'), 'refund test must run deterministic generated sequences')
  assert(script.includes('STEPS_PER_SEQUENCE = 90'), 'refund test must run long enough generated sequences')
  assert(script.includes('PARTIAL_REFUND_POSTED'), 'refund test must allow legitimate partial refunds')
  assert(script.includes('ORDER_REFUND_EXCEEDS_CAPTURED_DEBIT'), 'refund test must reject per-order over-refunds')
  assert(script.includes('REFUND_IDEMPOTENT_REPLAY'), 'refund test must prove duplicate refund replay does not double-credit')
  assert(script.includes('REFUND_IDEMPOTENCY_CONFLICT'), 'refund test must reject changed duplicate refund payloads')
  assert(script.includes('ORDER_REFUND_OWNER_MISMATCH'), 'refund test must reject refunds of another wallet debit')
  assert(script.includes('ORIGINAL_DEBIT_NOT_FOUND'), 'refund test must reject refunds without original backed debits')
})

check('provider decision tests cover fake payment and duplicate webhook cases', () => {
  const script = read('scripts/wallet-provider-decision-test.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:providers": "node scripts/wallet-provider-decision-test.mjs"'), 'package script must expose provider decision tests')
  assert(script.includes('PENDING_PAYMENT_NOT_FOUND'), 'provider test must block references not created by the server')
  assert(script.includes('PENDING_PAYMENT_USER_MISMATCH'), 'provider test must block wrong-wallet payment claims')
  assert(script.includes('PROVIDER_UNAVAILABLE_RETRY'), 'provider test must keep timeout/unavailable checks pending')
  assert(script.includes('PROVIDER_PENDING'), 'provider test must keep pending provider status uncredited')
  assert(script.includes('closesPendingPayment'), 'provider test must prove definitive failures close pending payment evidence')
  assert(script.includes('AMOUNT_MISMATCH'), 'provider test must block wrong-amount payments')
  assert(script.includes('CURRENCY_MISMATCH'), 'provider test must block wrong-currency payments')
  assert(script.includes('MERCHANT_MISMATCH'), 'provider test must block wrong merchant when configured')
  assert(script.includes('ENVIRONMENT_MISMATCH'), 'provider test must block wrong environment when configured')
  assert(script.includes('EXTERNAL_PAYMENT_ID_CONFLICT'), 'provider test must block one provider payment funding two wallets')
  assert(script.includes('RECOVERY_ALREADY_CLAIMED'), 'provider test must prove overlapping pending-payment recovery workers skip stale claims')
  assert(script.includes('INVALID_WEBHOOK_VERIFICATION'), 'provider test must reject unsigned/invalid PocketFi webhooks')
  assert(script.includes('PARTNER_API_PAUSED_MANUAL_REVIEW'), 'provider test must hold partner payments while partner API is paused')
  assert(script.includes('POCKETFI_REFERENCE_CONFLICT'), 'provider test must block duplicate reference conflicts')
  assert(script.includes('nowpayments'), 'provider test must include NOWPayments crypto decisions')
  assert(script.includes('INVALID_IPN_SIGNATURE'), 'provider test must reject missing/invalid NOWPayments signatures')
  assert(script.includes('PARTIAL_PAYMENT_HELD'), 'provider test must hold partial NOWPayments payments without credit')
  assert(script.includes('PROVIDER_STATUS_VERIFICATION_FAILED'), 'provider test must require server-side NOWPayments status verification')
  assert(script.includes('provider_paid_amount_too_low'), 'provider test must reject underpaid NOWPayments status checks')
  assert(script.includes('provider_order_reference_mismatch'), 'provider test must reject wrong NOWPayments order references')
  assert(script.includes('provider_currency_mismatch'), 'provider test must reject wrong NOWPayments currency')
  assert(script.includes('COMPLETED_PENDING_REVIEW'), 'provider test must hold finished NOWPayments payments for manual review')
})

check('provider evidence template covers every external provider proof set', () => {
  const script = read('scripts/wallet-provider-evidence-template.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:provider-evidence": "node scripts/wallet-provider-evidence-template.mjs"'), 'package script must expose provider evidence template')
  for (const provider of [
    'ercas',
    'pocketfi',
    'nowpayments',
    'istar',
    'daisysms',
    'smm',
    'bitrefill',
    'withdrawal',
  ]) {
    assert(script.includes(`id: '${provider}'`), `provider evidence template missing ${provider}`)
  }
  for (const needle of [
    '--validate provider-evidence.json',
    '--filled-template',
    '--self-test',
    'validateEvidenceObject',
    'buildFilledEvidenceTemplate',
    'PROVIDER_NOT_PASSED',
    'PROOF_NOT_PASSED',
    'deploymentEvidenceReference',
    'DUPLICATE_PROVIDER',
    'DUPLICATE_PROOF',
    'INVALID_VERIFIED_AT',
    'SECRET_LIKE_VALUE',
    'DEPLOYMENT_EVIDENCE_REFERENCE_WEAK',
    'UNKNOWN_PROOF',
    'wrong wallet/user does not credit',
    'duplicate reference for different user or amount returns POCKETFI_REFERENCE_CONFLICT',
    'partial/underpaid/disappearing payment does not become spendable',
    'duplicate failed callback does not double-refund',
    'late code after terminal failure does not reveal code',
    'provider timeout becomes outcome_unknown without blind retry or refund',
    'timeout/unknown invoice status does not blind retry or refund',
    'crypto/referral balance source cannot be swapped by client payload',
    'provider proof must reference deployed-version evidence before reopening',
    'weak deployed-version evidence references are rejected',
    'unknown proof rows and secret-looking extra proof references are rejected',
    'duplicate required proof rows are rejected',
    'passed provider proof rows require sandbox/dashboard/log references',
    'Do not paste secrets',
  ]) {
    assert(script.includes(needle), `provider evidence template missing ${needle}`)
  }
  assert(read('docs/security/wallet-owner-verification-checklist.md').includes('deploymentEvidenceReference'), 'owner checklist must require provider evidence to reference deployed-version evidence')
  assert(read('docs/security/wallet-production-evidence-register.md').includes('deploymentEvidenceReference'), 'production evidence register must require provider evidence to reference deployed-version evidence')
  assert(read('docs/security/wallet-test-report.md').includes('missing or weak deployed-version evidence linkage'), 'test report must document provider evidence deployment linkage validation')
})

check('paid-route reopening readiness gate requires all external proof files', () => {
  const script = read('scripts/wallet-reopen-readiness-check.mjs')
  const pkg = read('package.json')
  const localSuite = read('scripts/wallet-local-security-suite.mjs')
  const checklist = read('docs/security/wallet-owner-verification-checklist.md')
  const register = read('docs/security/wallet-production-evidence-register.md')
  const testReport = read('docs/security/wallet-test-report.md')

  assert(pkg.includes('"security:wallet:reopen-readiness": "node scripts/wallet-reopen-readiness-check.mjs"'), 'package script must expose reopening readiness gate')
  assert(localSuite.includes('scripts/wallet-reopen-readiness-check.mjs'), 'local suite must run reopening readiness gate self-test')
  for (const needle of [
    '--deployment-plan',
    '--deployed-version-evidence',
    '--init-bundle',
    '--production-evidence',
    '--provider-evidence',
    '--denied-probes',
    '--deployed-smoke-result',
    'validateReopenReadiness',
    'wallet-deployment-manifest-check.mjs',
    'createEvidenceBundle',
    'buildBundleReadme',
    'buildDeployedSmokeResultTemplate',
    'validateDeployedSmokeResult',
    'bundleScaffold',
    'DEPLOYMENT_PLAN_MISSING',
    'DEPLOYED_VERSION_EVIDENCE_MISSING',
    'PRODUCTION_EVIDENCE_MISSING',
    'PROVIDER_EVIDENCE_MISSING',
    'DENIED_PROBES_MISSING',
    'DEPLOYED_SMOKE_RESULT_MISSING',
    'FUNCTIONS_BASE_URL_REQUIRED',
    'EDGE_AUTH_REQUIRED',
    'OWNER_DENIED_PROBES_REQUIRED',
    'PROBE_NOT_PASSED',
    'BOUNDARY_MISSING',
    'wallet-deployed-version-evidence.mjs',
    'wallet-production-evidence-check.mjs',
    'wallet-provider-evidence-template.mjs',
    'wallet-deployed-smoke-test.mjs',
    'Do not reopen a paused paid route',
    'evidence gate before a paused paid route',
    'The generated files are templates, not proof.',
  ]) {
    assert(script.includes(needle), `reopening readiness gate missing ${needle}`)
  }
  assert(checklist.includes('security:wallet:reopen-readiness'), 'owner checklist must include reopening readiness gate')
  assert(checklist.includes('--deployment-plan'), 'owner checklist must require deployment plan evidence for reopening readiness')
  assert(register.includes('Paid-route reopening readiness gate'), 'production evidence register must track reopening readiness gate')
  assert(register.includes('deployment plan'), 'production evidence register must track deployment-plan validation for reopening readiness')
  assert(testReport.includes('reopening-readiness self-test'), 'test report must document reopening readiness self-test')
  assert(testReport.includes('deployment plan'), 'test report must document deployment-plan evidence in reopening readiness')
})

check('fulfillment decision tests cover authorization and reveal policy', () => {
  const script = read('scripts/wallet-fulfillment-decision-test.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:fulfillment": "node scripts/wallet-fulfillment-decision-test.mjs"'), 'package script must expose fulfillment decision tests')
  assert(script.includes('INSUFFICIENT_FUNDS'), 'fulfillment test must decline insufficient funds before authorization')
  assert(script.includes('FINANCIAL_STATE_UNAVAILABLE'), 'fulfillment test must decline unavailable financial state before authorization')
  assert(script.includes('WALLET_NOT_ACTIVE'), 'fulfillment test must block frozen wallet authorization/dispatch')
  assert(script.includes('FULFILLMENT_PAUSED'), 'fulfillment test must block dispatch during global pause')
  assert(script.includes('ORDER_AUTHORIZATION_INVALID'), 'fulfillment test must reject missing or consumed authorization')
  assert(script.includes('ORDER_AUTHORIZATION_AMOUNT_MISMATCH'), 'fulfillment test must reject mismatched authorization amount')
  assert(script.includes('ORDER_AUTHORIZATION_STALE'), 'fulfillment test must reject stale authorizations after security-version changes')
  assert(script.includes('outcome_unknown'), 'fulfillment test must preserve unknown supplier outcomes without blind retry/refund')
  assert(script.includes('failed_released'), 'fulfillment test must release pre-capture failures without refund credit')
  assert(script.includes('refund_pending'), 'fulfillment test must refund post-capture failures without hold release')
  assert(script.includes('RESERVATION_FAILED_REFUNDED'), 'fulfillment test must refund local-stock reservation failures after debit')
  assert(script.includes('!stockRace.credentialsCreated && !stockRace.soldMarked'), 'fulfillment test must prove reservation failure does not reveal credentials or mark stock sold')
  assert(script.includes('NOTIFICATION_FAILED_NO_DELIVERY'), 'fulfillment test must prove notification failure cannot convert denial into delivery')
  assert(script.includes('!deniedWithNotificationFailure.sendSupplier'), 'fulfillment test must assert notification failure keeps supplier dispatch blocked')
  assert(script.includes('CREDENTIALS_HIDDEN_UNTIL_COMPLETED'), 'fulfillment test must hide credentials until completion')
})

check('incident wallet mutation and fulfillment maps cover controlled boundaries', () => {
  const mutationMap = read('docs/security/wallet-mutation-map.md')
  const fulfillmentMap = read('docs/security/wallet-fulfillment-map.md')

  for (const needle of [
    'apply_wallet_transaction',
    'ledger-direct-write-guard',
    'profile-balance-guard',
    'ercas-verify-credit',
    'pocketfi-webhook',
    'nowpayments-webhook',
    'product-purchase',
    'smm-purchase',
    'sms-purchase',
    'telegram-purchase',
    'OWNER_PRODUCTION_CHECK_REQUIRED',
    'HISTORICAL_CAUSE_UNPROVEN',
  ]) {
    assert(mutationMap.includes(needle), `wallet mutation map missing ${needle}`)
  }

  for (const label of [
    'PATCH_IMPLEMENTED',
    'PAUSED',
    'OWNER_PRODUCTION_CHECK_REQUIRED',
    'HISTORICAL_CAUSE_UNPROVEN',
  ]) {
    assert(mutationMap.includes(`\`${label}\``), `wallet mutation map missing classification label ${label}`)
    assert(fulfillmentMap.includes(`\`${label}\``), `wallet fulfillment map missing classification label ${label}`)
  }

  for (const needle of [
    'Pre-stocked account credentials',
    'Live account suppliers',
    'SMM/social boost',
    'SMS OTP rental',
    'Telegram Stars',
    'Bills and airtime',
    'Gift cards/eSIM',
    'Withdrawals',
    'Crypto top-up',
    'Partner API checkout',
    'PocketFi partner customer payments',
    'supplier calls, credential reveal, transfers, or partner fulfillment',
    'happen before authorization',
  ]) {
    assert(fulfillmentMap.includes(needle), `wallet fulfillment map missing ${needle}`)
  }
})

check('route inventory classifies every API and Edge Function surface', () => {
  const inventory = read('docs/security/wallet-route-inventory.md')
  const script = read('scripts/wallet-route-inventory-check.mjs')
  const smoke = read('scripts/wallet-deployed-smoke-test.mjs')
  const suite = read('scripts/wallet-local-security-suite.mjs')
  const pkg = read('package.json')

  assert(pkg.includes('"security:wallet:route-inventory": "node scripts/wallet-route-inventory-check.mjs"'), 'package script must expose route inventory check')
  assert(suite.includes('scripts/wallet-route-inventory-check.mjs'), 'local suite must include route inventory check')

  for (const label of [
    'VALUE_DELIVERY',
    'FUNDING_OR_WEBHOOK',
    'ADMIN_OR_INTERNAL',
    'READ_ONLY_OR_CATALOG',
    'TELEMETRY_OR_UTILITY',
    'PAUSED_OR_MANUAL_REVIEW',
  ]) {
    assert(inventory.includes(label), `route inventory missing label ${label}`)
    assert(script.includes(label), `route inventory checker missing label ${label}`)
  }

  for (const surface of [
    'api/partner-api.ts',
    'api/webhook-ercas.ts',
    'api/webhook-istar.ts',
    'api/webhook-pocketfi.ts',
    'pages/api/webhook/ercas.ts',
    'process-purchase',
    'smm-create-order',
    'smsbus',
    'telegram-stars',
    'purchase-bills',
    'purchase-bitrefill',
    'create-withdrawal-request',
    'partner-api',
    'webhook-pocketfi',
    'verify-and-credit-wallet',
    'src/pages/CheckoutPage.tsx',
    'src/pages/WalletPage.tsx',
    'src/pages/ReferralsPage.tsx',
    'Any new `api/**/*.ts`, `pages/api/**/*.ts`, `supabase/functions/*/index.ts`',
  ]) {
    assert(inventory.includes(surface), `route inventory missing surface ${surface}`)
    assert(script.includes(surface), `route inventory checker missing surface ${surface}`)
  }
  for (const fn of [
    'auto-restock',
    'create-crypto-sell-order',
    'create-withdrawal-request',
    'manual-restock',
    'muabanvia-fulfill',
    'partner-api',
    'purchase-bills',
    'purchase-bitrefill',
    'smm-create-order',
    'smsbus',
    'telegram-stars',
    'withdraw-referral-balance',
  ]) {
    assert(script.includes(fn), `route inventory checker must track paused value function ${fn}`)
    assert(smoke.includes(fn), `deployed smoke runner must probe paused value function ${fn}`)
  }
  assert(script.includes('pausedValueSmokeProbes'), 'route inventory checker must report paused value smoke probe coverage')
  const report = read('docs/security/wallet-test-report.md')
  assert(report.includes('17 frontend value surfaces'), 'test report must document current route-inventory frontend surface count')
  assert(report.includes('13 value-delivery functions, and 9 funding/webhook functions'), 'test report must document current route-inventory value/funding function counts')
  assert(report.includes('every paused value-delivery Edge Function has a matching deployed smoke denied/paused probe'), 'test report must document paused value smoke probe consistency')
})

check('environment and secret inventory blocks browser-exposed provider secrets', () => {
  const inventory = read('docs/security/wallet-env-secret-inventory.md')
  const script = read('scripts/wallet-env-secret-check.mjs')
  const suite = read('scripts/wallet-local-security-suite.mjs')
  const pkg = read('package.json')
  const envExample = read('.env.example')

  assert(pkg.includes('"security:wallet:env-secrets": "node scripts/wallet-env-secret-check.mjs"'), 'package script must expose env secret check')
  assert(suite.includes('scripts/wallet-env-secret-check.mjs'), 'local suite must include env secret check')
  assert(!envExample.includes('VITE_ERCAS_SECRET_KEY'), '.env.example must not expose Ercas secret with VITE_ prefix')
  assert(!/ECRS-(?:TEST|LIVE)-[A-Za-z0-9]{16,}/.test(envExample), '.env.example must not contain real-looking Ercas keys')

  for (const needle of [
    'Browser-exposed `VITE_` variables may contain only public configuration',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_LIVE_ACCOUNT_FULFILLMENT_ENABLED',
    'Do not add `VITE_ERCAS_SECRET_KEY`',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ERCASPAY_SECRET_KEY',
    'ERCAS_SECRET_KEY',
    'POCKETFI_WEBHOOK_SECRET',
    'NOWPAYMENTS_IPN_SECRET',
    'ISTAR_WEBHOOK_SECRET',
    'DAISYSMS_WEBHOOK_SECRET',
    'SMM_PANEL_API_KEY',
    'BITREFILL_API_KEY',
    'SAGECLOUD_SECRET_KEY',
    'PARTNER_API_INTERNAL_SECRET',
    'CRYPTO_AUTO_CREDIT_ENABLED',
    'PARTNER_API_PAUSED',
    'Rotate any value that was exposed',
  ]) {
    assert(inventory.includes(needle), `env inventory missing ${needle}`)
    assert(script.includes(needle), `env secret checker missing ${needle}`)
  }

  assert(inventory.includes('BILLS_ENABLED=false'), 'env inventory missing BILLS_ENABLED=false pause requirement')
  assert(inventory.includes('SMM_ORDERS_ENABLED=false'), 'env inventory missing SMM_ORDERS_ENABLED=false pause requirement')
  assert(inventory.includes('SMS_OTP_ENABLED=false'), 'env inventory missing SMS_OTP_ENABLED=false pause requirement')
  assert(inventory.includes('TELEGRAM_ORDERS_ENABLED=false'), 'env inventory missing TELEGRAM_ORDERS_ENABLED=false pause requirement')
  assert(script.includes('BILLS_ENABLED'), 'env secret checker missing BILLS_ENABLED pause flag')
  assert(read('docs/security/wallet-test-report.md').includes('scanned 82 env variables across 261 source files'), 'test report must document current env-secret scan scope')
})

check('incident regression matrix tracks T01 through T80 evidence status', () => {
  const matrix = read('docs/security/wallet-regression-matrix.md')

  for (let i = 1; i <= 80; i += 1) {
    const id = `T${String(i).padStart(2, '0')}`
    assert(matrix.includes(`| ${id} |`), `regression matrix missing ${id}`)
  }

  for (const status of [
    'STATIC_SOURCE_COVERED',
    'LOCAL_ADMIN_UI_MODEL_PASSED',
    'LOCAL_CUSTOMER_UI_MODEL_PASSED',
    'LOCAL_FROZEN_ACCESS_MODEL_PASSED',
    'LOCAL_MONEY_BOUNDARY_PASSED',
    'LOCAL_TRUSTED_PRINCIPAL_PASSED',
    'LOCAL_ROUTE_SOURCE_ORDER_PASSED',
    'LOCAL_PROVIDER_ADAPTER_MOCK_PASSED',
    'LOCAL_FULFILLMENT_DECISION_PASSED',
    'LOCAL_RECONCILE_OFFLINE_PASSED',
    'LOCAL_REFUND_CONSERVATION_PASSED',
    'LOCAL_RESERVATION_MODEL_PASSED',
    'LOCAL_DEPLOYED_VERSION_EVIDENCE_PASSED',
    'DB_CONCURRENCY_RUNNER_CREATED_NOT_RUN',
    'STAGING_SQL_CREATED_NOT_RUN',
    'PATCH_IMPLEMENTED_TEST_PENDING',
    'PROVIDER_TEST_PENDING',
    'CONCURRENCY_TEST_PENDING',
    'PRODUCTION_OWNER_PENDING',
    'NOT_IMPLEMENTED_AS_FULL_TEST',
  ]) {
    assert(matrix.includes(status), `regression matrix missing status ${status}`)
  }

  const definedStatuses = new Set(
    [...matrix.matchAll(/^- `([A-Z0-9_]+)`: /gm)]
      .map((match) => match[1]),
  )
  const tableStatuses = new Set(
    [...matrix.matchAll(/^\| T\d{2} \|[^|]*\|([^|]*)\|/gm)]
      .flatMap((match) => [...match[1].matchAll(/`([A-Z0-9_]+)`/g)].map((statusMatch) => statusMatch[1])),
  )

  for (const status of tableStatuses) {
    assert(definedStatuses.has(status), `regression matrix uses undefined status ${status}`)
  }

  assert(matrix.includes('The repository now has containment, maps, static guards, and staging SQL'), 'regression matrix must preserve the acceptance boundary')
  const pkg = read('package.json')
  const localSuite = read('scripts/wallet-local-security-suite.mjs')
  assert(pkg.includes('security:wallet:admin-ui'), 'package scripts must expose the admin UI model regression test')
  assert(localSuite.includes('scripts/wallet-admin-ui-model-test.mjs'), 'local wallet security suite must run the admin UI model regression test')
  assert(pkg.includes('security:wallet:customer-ui'), 'package scripts must expose the customer UI transaction-display regression test')
  assert(localSuite.includes('scripts/wallet-customer-ui-model-test.mjs'), 'local wallet security suite must run the customer UI transaction-display regression test')
  assert(pkg.includes('security:wallet:frozen-access'), 'package scripts must expose the frozen-access model regression test')
  assert(localSuite.includes('scripts/wallet-frozen-access-model-test.mjs'), 'local wallet security suite must run the frozen-access model regression test')
  assert(pkg.includes('security:wallet:money-boundaries'), 'package scripts must expose the money boundary regression test')
  assert(localSuite.includes('scripts/wallet-money-boundary-test.mjs'), 'local wallet security suite must run the money boundary regression test')
  assert(pkg.includes('security:wallet:reconcile-offline'), 'package scripts must expose the offline reconciliation regression test')
  assert(localSuite.includes('scripts/wallet-reconcile-offline-test.mjs'), 'local wallet security suite must run the offline reconciliation regression test')
  assert(pkg.includes('security:wallet:trusted-principal'), 'package scripts must expose the trusted-principal regression test')
  assert(localSuite.includes('scripts/wallet-trusted-principal-test.mjs'), 'local wallet security suite must run the trusted-principal regression test')
  const trustedPrincipalTest = read('scripts/wallet-trusted-principal-test.mjs')
  assert(trustedPrincipalTest.includes('function isTrustedPrincipalAuthorizedDebit'), 'trusted-principal test must require an explicit trusted-authorized debit marker for refund restoration')
  assert(trustedPrincipalTest.includes("metadata?.trusted_principal_authorized"), 'trusted-principal test must inspect trusted_principal_authorized metadata on original debits')
  assert(trustedPrincipalTest.includes("metadata?.trusted_principal_debit_amount"), 'trusted-principal test must require trusted_principal_debit_amount metadata on original debits')
  assert(trustedPrincipalTest.includes('fake trusted-principal metadata without trusted debit amount cannot create refundable capacity even when deposits exist'), 'trusted-principal test must reject fake trusted metadata even when real deposits exist')
  assert(trustedPrincipalTest.includes('fake trusted-principal metadata on an unbacked debit still cannot create refundable trusted capacity'), 'trusted-principal test must reject fake trusted metadata when no real principal backed the debit')
  assert(trustedPrincipalTest.includes('deposit-backed legacy debits still need trusted-principal authorization before refunds can restore funds'), 'trusted-principal test must reject refunds of deposit-backed but unmarked legacy debits')
  assert(trustedPrincipalTest.includes('pending refunds do not consume the original debit refund cap before completion'), 'trusted-principal test must prove pending refunds do not consume the refund cap')
  assert(trustedPrincipalTest.includes('completed status checks are case-normalized for imported or legacy rows'), 'trusted-principal test must prove completed status case normalization')
  assert(trustedPrincipalTest.includes('isCompleted(entry) && isRefund(entry)'), 'trusted-principal refund decision must count only completed prior refunds')
  assert(!trustedPrincipalTest.includes('const originalState = calculateTrustedState(entries.filter'), 'trusted-principal test must not infer original refund trust from total principal alone')
  assert(pkg.includes('security:wallet:route-source-order'), 'package scripts must expose the route source ordering audit')
  assert(localSuite.includes('scripts/wallet-route-source-order-test.mjs'), 'local wallet security suite must run the route source ordering audit')
  assert(pkg.includes('security:wallet:reservations'), 'package scripts must expose the reservation decision test')
  assert(localSuite.includes('scripts/wallet-reservation-decision-test.mjs'), 'local wallet security suite must run the reservation decision test')
})

check('wallet financial model documents backed funds and remaining hold gaps', () => {
  const model = read('docs/security/wallet-financial-model.md')

  for (const needle of [
    'authoritative_backed_available',
    'trusted_principal',
    'verified_gateway_deposits',
    'approved_admin_credits',
    'matching trusted',
    'provider evidence',
    'pending_payments',
    'pocketfi_webhook_logs',
    'verified_amount_ngn',
    'verified_reference',
    'deposit-looking row with only an external ID',
    'trusted_debit_capacity',
    'trusted_consumed_spend',
    'eligible_refunds',
    'linked_eligible_refunds',
    'refund rows that are not linked to a trusted-principal-authorized original',
    'previous_completed_wallet_debits',
    'eligible_refunds = min(linked_eligible_refunds, trusted_debit_capacity)',
    'refundable_remaining = trusted_debit_capacity - linked_eligible_refunds',
    'WALLET_UNBACKED_FUNDS',
    'FOR UPDATE',
    'Ordinary insufficient funds should not by itself suspend the customer',
    'The current patch does not claim a complete reserve-first design',
    'B = posted book balance',
    'H = outstanding valid holds',
    'A = available to spend = B - H',
    'per-order partial-refund conservation is modeled locally',
    'Chargebacks and correction debits are accounting events',
    'preserve a negative',
    'posted wallet balance',
    'Manual owner/admin chargeback recording now posts through the wallet engine as',
    'provider-specific automated chargeback ingestion and full live debt-review',
    'production permissions and deployed function versions remain owner-verified',
    'valid reservations reduce available',
    'Durable Dispatch And Outbox Policy',
    'a crash after commit leaves one recoverable dispatch message',
    'only the worker that holds the claim can dispatch the message',
    'local policy coverage, not proof of a deployed transactional outbox',
  ]) {
    assert(model.includes(needle), `wallet financial model missing ${needle}`)
  }
})

check('wallet incident final report separates source fixes from production proof', () => {
  const report = read('docs/security/wallet-incident-final-report.md')

  for (const needle of [
    'HISTORICAL_CAUSE_UNPROVEN',
    'Vulnerable Or Suspicious Paths',
    'Fake Gateway Trigger Assessment',
    'P0 Containment Coverage',
    'Permanent Financial Changes',
    'Fulfillment Boundary Changes',
    'Commands Run',
    'Not Run',
    'Required Owner Deployment Actions',
    'Remaining Risks',
    'PRODUCTION_VERIFICATION_PENDING_OWNER',
    'WALLET_UNBACKED_FUNDS',
    'IDEMPOTENCY_CONFLICT',
    'Partner API closed',
    'PocketFi bridge',
    'Legacy Ercas',
    'NOWPayments',
    'Supporting Artifacts',
    '89 checks passing',
    'route inventory',
    'env/secret inventory',
    'wallet_security_events',
    'outbox/queue dispatch decision coverage',
    'completed loose refund rows without original-debit linkage',
    'Reserve-first holds and transactional outbox/worker-claim behavior are now',
    'scripts/wallet-outbox-decision-test.mjs',
  ]) {
    assert(report.includes(needle), `wallet incident final report missing ${needle}`)
  }

  assert(!report.includes('reports 73 checks'), 'wallet incident final report has stale wallet check count')
  assert(!report.includes('reports 74 checks'), 'wallet incident final report has stale wallet check count')
  assert(!report.includes('reports 75 checks'), 'wallet incident final report has stale wallet check count')
  assert(!report.includes('reports 76 checks'), 'wallet incident final report has stale wallet check count')
  assert(!report.includes('83 checks passing'), 'wallet incident final report has stale wallet check count')
})

let failed = 0
for (const item of checks) {
  try {
    item.fn()
    console.log(`ok - ${item.name}`)
  } catch (error) {
    failed += 1
    console.error(`not ok - ${item.name}`)
    console.error(`  ${error.message}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} security check(s) failed.`)
  process.exit(1)
}

console.log(`\n${checks.length} security checks passed.`)
