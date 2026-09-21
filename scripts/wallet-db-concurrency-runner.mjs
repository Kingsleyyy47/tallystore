import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'

const args = parseArgs(process.argv.slice(2))

if (args.get('help') === 'true' || args.get('h') === 'true') {
  printHelp()
  process.exit(0)
}

const envName = clean(process.env.TALLYSTORE_DB_TEST_ENV).toLowerCase()
const ack = clean(process.env.TALLYSTORE_DB_CONCURRENCY_ACK)
const databaseUrl = clean(process.env.SUPABASE_DB_URL) || clean(process.env.DATABASE_URL)
const testUserId = clean(args.get('test-user-id') || process.env.TALLYSTORE_DB_TEST_USER_ID)
const secondTestUserId = clean(args.get('second-test-user-id') || process.env.TALLYSTORE_DB_SECOND_TEST_USER_ID)
const jsonOnly = args.get('json') === 'true'
const timeoutMs = Number(process.env.TALLYSTORE_DB_CONCURRENCY_TIMEOUT_MS || 180_000)
const runId = `wallet-db-concurrency-test-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`

if (args.get('self-test') === 'true') {
  runSelfTest()
  process.exit(0)
}

if (!['local', 'staging', 'owner-controlled'].includes(envName)) {
  fail('Set TALLYSTORE_DB_TEST_ENV to local, staging, or owner-controlled. This runner refuses production.')
}

if (ack !== 'I_UNDERSTAND_COMMITTED_TEST_WALLET_MUTATIONS') {
  fail('Set TALLYSTORE_DB_CONCURRENCY_ACK=I_UNDERSTAND_COMMITTED_TEST_WALLET_MUTATIONS before running committed concurrency tests.')
}

if (!databaseUrl) {
  fail('Set SUPABASE_DB_URL or DATABASE_URL for the staging/local/owner-controlled Postgres database.')
}

if (!isUuid(testUserId)) {
  fail('Provide --test-user-id <ordinary-customer-uuid> or TALLYSTORE_DB_TEST_USER_ID.')
}

if (secondTestUserId && !isUuid(secondTestUserId)) {
  fail('Provide --second-test-user-id <ordinary-customer-uuid> or TALLYSTORE_DB_SECOND_TEST_USER_ID as a valid UUID when testing cross-wallet provider identity races.')
}

if (secondTestUserId && secondTestUserId.toLowerCase() === testUserId.toLowerCase()) {
  fail('--second-test-user-id must be a different ordinary customer from --test-user-id.')
}

const psqlProbe = spawnSync('psql', ['--version'], { encoding: 'utf8', timeout: 15_000 })
if (psqlProbe.status !== 0) {
  fail('psql is not available on PATH. Install PostgreSQL client tools or run this from an environment that has psql.')
}

const startedAt = new Date().toISOString()
let cleanupResult = null

try {
  const setup = runPsql('setup', setupSql())
  if (!setup.ok) throw new Error(`setup failed: ${setup.stderrTail || setup.stdoutTail}`)

  const purchases = await runConcurrent([
    ['purchase-a', purchaseSql('a')],
    ['purchase-b', purchaseSql('b')],
  ])
  const purchaseVerify = runPsql('verify-purchase-race', verifyPurchaseSql())
  if (!purchaseVerify.ok) throw new Error(`purchase race verification failed: ${purchaseVerify.stderrTail || purchaseVerify.stdoutTail}`)

  const refunds = await runConcurrent([
    ['refund-a', refundSql('a')],
    ['refund-b', refundSql('b')],
  ])
  const refundVerify = runPsql('verify-refund-race', verifyRefundSql())
  if (!refundVerify.ok) throw new Error(`refund race verification failed: ${refundVerify.stderrTail || refundVerify.stdoutTail}`)

  let providerIdentityRace = null
  if (secondTestUserId) {
    const providerSetup = runPsql('setup-provider-identity-race', setupProviderIdentityRaceSql())
    if (!providerSetup.ok) throw new Error(`provider identity race setup failed: ${providerSetup.stderrTail || providerSetup.stdoutTail}`)

    const providerCredits = await runConcurrent([
      ['provider-credit-primary', providerCreditSql(testUserId, 'primary')],
      ['provider-credit-second', providerCreditSql(secondTestUserId, 'second')],
    ])
    const providerVerify = runPsql('verify-provider-identity-race', verifyProviderIdentityRaceSql())
    if (!providerVerify.ok) throw new Error(`provider identity race verification failed: ${providerVerify.stderrTail || providerVerify.stdoutTail}`)
    providerIdentityRace = summarizeChildren(providerCredits)
  }

  const freezeDurability = runPsql('verify-unbacked-freeze-durability', freezeDurabilitySql())
  if (!freezeDurability.ok) throw new Error(`unbacked freeze durability verification failed: ${freezeDurability.stderrTail || freezeDurability.stdoutTail}`)

  cleanupResult = runPsql('cleanup', cleanupSql())
  if (!cleanupResult.ok) throw new Error(`cleanup failed: ${cleanupResult.stderrTail || cleanupResult.stdoutTail}`)

  const summary = {
    ok: true,
    environment: envName,
    testUserId,
    secondTestUserId: secondTestUserId || null,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    psqlVersion: (psqlProbe.stdout || psqlProbe.stderr || '').trim().split(/\r?\n/)[0],
    timeoutMs,
    purchaseRace: summarizeChildren(purchases),
    refundRace: summarizeChildren(refunds),
    providerIdentityRace: providerIdentityRace || 'skipped: provide --second-test-user-id to test one provider payment racing across two wallets',
    freezeDurability,
    checks: [
      'one of two concurrent over-total purchases can commit at most one debit',
      'duplicate concurrent refunds against one original debit commit at most one refund',
      secondTestUserId
        ? 'one provider payment identity racing across two wallets can commit at most one verified credit'
        : 'cross-wallet provider payment identity race skipped because no second ordinary test user was supplied',
      'an unbacked purchase denial durably freezes the wallet without inserting a purchase ledger row',
      'final staging state is verified after each race',
      'test wallet cleanup ran after committed staging mutations',
    ],
  }
  output(summary)
} catch (error) {
  if (!cleanupResult) cleanupResult = runPsql('cleanup-after-failure', cleanupSql())
  output({
    ok: false,
    environment: envName,
    testUserId,
    secondTestUserId: secondTestUserId || null,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    psqlVersion: (psqlProbe.stdout || psqlProbe.stderr || '').trim().split(/\r?\n/)[0],
    timeoutMs,
    error: error instanceof Error ? error.message : String(error),
    cleanup: cleanupResult,
  })
  process.exit(1)
}

function setupSql() {
  const user = sqlString(testUserId)
  return `
DO $$
DECLARE
  v_user uuid := ${user}::uuid;
  v_profile record;
  v_topup jsonb;
BEGIN
  SELECT id, is_admin, is_staff INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: profile % not found', v_user;
  END IF;

  IF COALESCE(v_profile.is_admin, false) OR COALESCE(v_profile.is_staff, false) THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: profile % must be ordinary customer', v_user;
  END IF;

  PERFORM set_config('app.tally_wallet_engine_authorized', 'true', true);
  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  DELETE FROM public.transactions
  WHERE user_id = v_user
    AND (
      COALESCE(idempotency_key, '') LIKE ${sqlString(`${runId}:%`)}
      OR COALESCE(reference, '') LIKE ${sqlString(`${runId}-%`)}
    );

  DELETE FROM public.pending_payments
  WHERE user_id = v_user
    AND transaction_reference LIKE ${sqlString(`${runId}-%`)};

  UPDATE public.profiles
  SET wallet_balance = 0,
      account_suspended = false,
      suspension_reason = null,
      suspended_at = null,
      updated_at = now()
  WHERE id = v_user;

  PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

  INSERT INTO public.pending_payments (user_id, transaction_reference, ercas_reference, amount, status)
  VALUES (v_user, ${sqlString(`${runId}-topup`)}, ${sqlString(`${runId}-provider`)}, 1000, 'pending');

  SELECT public.apply_wallet_transaction(
    v_user,
    'topup',
    1000,
    ${sqlString(`${runId}-topup`)},
    'Concurrency test verified topup',
    ${sqlString(`${runId}:topup`)},
    jsonb_build_object('source', 'wallet-db-concurrency-runner', 'provider', 'ercaspay', 'verified_amount_ngn', 1000, 'run_id', ${sqlString(runId)}),
    'NGN',
    'wallet',
    ${sqlString(`${runId}-provider`)},
    null
  ) INTO v_topup;

  IF COALESCE((v_topup->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: topup failed: %', v_topup;
  END IF;
END $$;
`
}

function purchaseSql(label) {
  return `
SELECT public.apply_wallet_transaction(
  ${sqlString(testUserId)}::uuid,
  'purchase',
  700,
  ${sqlString(`${runId}-purchase-${label}`)},
  ${sqlString(`Concurrent purchase ${label}`)},
  ${sqlString(`${runId}:purchase:${label}`)},
  jsonb_build_object(
    'source', 'wallet-db-concurrency-runner',
    'run_id', ${sqlString(runId)},
    'race', 'purchase',
    'label', ${sqlString(label)},
    'source_order_id', ${sqlString(`${runId}:purchase-order`)},
    'source_order_table', 'wallet_db_concurrency_test'
  ),
  'NGN',
  'wallet',
  null,
  null
);
`
}

function refundSql(label) {
  return `
SELECT public.apply_wallet_transaction(
  ${sqlString(testUserId)}::uuid,
  'refund',
  700,
  ${sqlString(`${runId}-refund-${label}`)},
  ${sqlString(`Concurrent refund ${label}`)},
  ${sqlString(`${runId}:refund:${label}`)},
  jsonb_build_object(
    'source', 'wallet-db-concurrency-runner',
    'run_id', ${sqlString(runId)},
    'race', 'refund',
    'label', ${sqlString(label)},
    'source_order_id', ${sqlString(`${runId}:purchase-order`)},
    'source_order_table', 'wallet_db_concurrency_test'
  ),
  'NGN',
  'wallet',
  null,
  null
);
`
}

function verifyPurchaseSql() {
  return `
DO $$
DECLARE
  v_user uuid := ${sqlString(testUserId)}::uuid;
  v_purchase_count integer;
  v_balance numeric;
BEGIN
  SELECT COUNT(*) INTO v_purchase_count
  FROM public.transactions
  WHERE user_id = v_user
    AND idempotency_key LIKE ${sqlString(`${runId}:purchase:%`)}
    AND type = 'purchase'
    AND status = 'completed';

  SELECT wallet_balance INTO v_balance
  FROM public.profiles
  WHERE id = v_user;

  IF v_purchase_count <> 1 THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: expected exactly one purchase, got %', v_purchase_count;
  END IF;

  IF round(COALESCE(v_balance, -1), 2) <> 300 THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: expected wallet balance 300 after purchase race, got %', v_balance;
  END IF;
END $$;
`
}

function verifyRefundSql() {
  return `
DO $$
DECLARE
  v_user uuid := ${sqlString(testUserId)}::uuid;
  v_refund_count integer;
  v_balance numeric;
BEGIN
  SELECT COUNT(*) INTO v_refund_count
  FROM public.transactions
  WHERE user_id = v_user
    AND idempotency_key LIKE ${sqlString(`${runId}:refund:%`)}
    AND type = 'refund'
    AND status = 'completed';

  SELECT wallet_balance INTO v_balance
  FROM public.profiles
  WHERE id = v_user;

  IF v_refund_count <> 1 THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: expected exactly one refund, got %', v_refund_count;
  END IF;

  IF round(COALESCE(v_balance, -1), 2) <> 1000 THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: expected wallet balance 1000 after refund race, got %', v_balance;
  END IF;
END $$;
`
}

function freezeDurabilitySql() {
  return `
DO $$
DECLARE
  v_user uuid := ${sqlString(testUserId)}::uuid;
  v_result jsonb;
  v_profile record;
  v_purchase_count integer;
BEGIN
  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  UPDATE public.profiles
  SET wallet_balance = 999999,
      account_suspended = false,
      suspension_reason = null,
      suspended_at = null,
      updated_at = now()
  WHERE id = v_user;

  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

  SELECT public.apply_wallet_transaction(
    v_user,
    'purchase',
    10000,
    ${sqlString(`${runId}-freeze-durability-purchase`)},
    'Unbacked purchase should freeze without ledger debit',
    ${sqlString(`${runId}:freeze-durability:purchase`)},
    jsonb_build_object(
      'source', 'wallet-db-concurrency-runner',
      'run_id', ${sqlString(runId)},
      'race', 'freeze_durability',
      'expected_denial', 'WALLET_UNBACKED_FUNDS'
    ),
    'NGN',
    'wallet',
    null,
    null
  ) INTO v_result;

  IF v_result->>'code' IS DISTINCT FROM 'WALLET_UNBACKED_FUNDS' THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: expected WALLET_UNBACKED_FUNDS freeze denial, got %', v_result;
  END IF;

  SELECT wallet_balance, account_suspended, suspension_reason
    INTO v_profile
  FROM public.profiles
  WHERE id = v_user;

  IF COALESCE(v_profile.account_suspended, false) IS NOT TRUE
    OR COALESCE(v_profile.suspension_reason, '') NOT ILIKE '%exceeds backed available funds%'
  THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: unbacked purchase denial did not durably freeze wallet. Profile: %', row_to_json(v_profile);
  END IF;

  IF round(COALESCE(v_profile.wallet_balance, -1), 2) <> 999999 THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: unbacked purchase denial changed stored wallet balance. Profile: %', row_to_json(v_profile);
  END IF;

  SELECT COUNT(*) INTO v_purchase_count
  FROM public.transactions
  WHERE user_id = v_user
    AND idempotency_key = ${sqlString(`${runId}:freeze-durability:purchase`)};

  IF v_purchase_count <> 0 THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: denied unbacked purchase inserted % ledger row(s)', v_purchase_count;
  END IF;
END $$;
`
}

function setupProviderIdentityRaceSql() {
  return `
DO $$
DECLARE
  v_primary uuid := ${sqlString(testUserId)}::uuid;
  v_second uuid := ${sqlString(secondTestUserId)}::uuid;
  v_profile record;
BEGIN
  FOR v_profile IN
    SELECT id, is_admin, is_staff
    FROM public.profiles
    WHERE id IN (v_primary, v_second)
  LOOP
    IF COALESCE(v_profile.is_admin, false) OR COALESCE(v_profile.is_staff, false) THEN
      RAISE EXCEPTION 'wallet-db-concurrency-test: profile % must be ordinary customer', v_profile.id;
    END IF;
  END LOOP;

  IF (SELECT COUNT(*) FROM public.profiles WHERE id IN (v_primary, v_second)) <> 2 THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: both provider-race fixture profiles must exist';
  END IF;

  PERFORM set_config('app.tally_wallet_engine_authorized', 'true', true);
  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  DELETE FROM public.transactions
  WHERE user_id IN (v_primary, v_second)
    AND (
      COALESCE(idempotency_key, '') LIKE ${sqlString(`${runId}:%`)}
      OR COALESCE(reference, '') LIKE ${sqlString(`${runId}-%`)}
      OR COALESCE(external_payment_id, '') LIKE ${sqlString(`${runId}-%`)}
    );

  DELETE FROM public.pending_payments
  WHERE user_id IN (v_primary, v_second)
    AND (
      transaction_reference LIKE ${sqlString(`${runId}-%`)}
      OR ercas_reference LIKE ${sqlString(`${runId}-%`)}
    );

  UPDATE public.profiles
  SET wallet_balance = 0,
      account_suspended = false,
      suspension_reason = null,
      suspended_at = null,
      updated_at = now()
  WHERE id IN (v_primary, v_second);

  PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);

  INSERT INTO public.pending_payments (user_id, transaction_reference, ercas_reference, amount, status)
  VALUES
    (v_primary, ${sqlString(`${runId}-shared-topup-primary`)}, ${sqlString(`${runId}-shared-provider`)}, 500, 'pending'),
    (v_second, ${sqlString(`${runId}-shared-topup-second`)}, ${sqlString(`${runId}-shared-provider`)}, 500, 'pending');
END $$;
`
}

function providerCreditSql(userId, label) {
  return `
SELECT public.apply_wallet_transaction(
  ${sqlString(userId)}::uuid,
  'topup',
  500,
  ${sqlString(`${runId}-shared-topup-${label}`)},
  ${sqlString(`Concurrent provider identity credit ${label}`)},
  ${sqlString(`${runId}:provider-credit:${label}`)},
  jsonb_build_object(
    'source', 'wallet-db-concurrency-runner',
    'provider', 'ercaspay',
    'verified_amount_ngn', 500,
    'run_id', ${sqlString(runId)},
    'race', 'provider_identity',
    'label', ${sqlString(label)}
  ),
  'NGN',
  'wallet',
  ${sqlString(`${runId}-shared-provider`)},
  null
);
`
}

function verifyProviderIdentityRaceSql() {
  return `
DO $$
DECLARE
  v_primary uuid := ${sqlString(testUserId)}::uuid;
  v_second uuid := ${sqlString(secondTestUserId)}::uuid;
  v_credit_count integer;
  v_pending_credited_count integer;
  v_balance_sum numeric;
BEGIN
  SELECT COUNT(*) INTO v_credit_count
  FROM public.transactions
  WHERE user_id IN (v_primary, v_second)
    AND external_payment_id = ${sqlString(`${runId}-shared-provider`)}
    AND type IN ('topup', 'top_up', 'top-up', 'wallet_topup', 'wallet_deposit', 'deposit')
    AND status = 'completed';

  SELECT COUNT(*) INTO v_pending_credited_count
  FROM public.pending_payments
  WHERE user_id IN (v_primary, v_second)
    AND ercas_reference = ${sqlString(`${runId}-shared-provider`)}
    AND lower(COALESCE(status, 'pending')) = 'credited';

  SELECT COALESCE(SUM(wallet_balance), 0) INTO v_balance_sum
  FROM public.profiles
  WHERE id IN (v_primary, v_second);

  IF v_credit_count <> 1 THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: expected one shared provider payment credit, got %', v_credit_count;
  END IF;

  IF v_pending_credited_count <> 1 THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: expected one consumed shared pending payment, got %', v_pending_credited_count;
  END IF;

  IF round(COALESCE(v_balance_sum, -1), 2) <> 500 THEN
    RAISE EXCEPTION 'wallet-db-concurrency-test: expected combined wallet balance 500 after shared provider race, got %', v_balance_sum;
  END IF;
END $$;
`
}

function cleanupSql() {
  return `
DO $$
DECLARE
  v_user uuid := ${sqlString(testUserId)}::uuid;
  v_second uuid := ${sqlUuidOrNull(secondTestUserId)};
BEGIN
  PERFORM set_config('app.tally_wallet_engine_authorized', 'true', true);
  PERFORM set_config('app.tally_profile_privileged_authorized', 'true', true);

  DELETE FROM public.transactions
  WHERE user_id IN (v_user, COALESCE(v_second, v_user))
    AND (
      COALESCE(idempotency_key, '') LIKE ${sqlString(`${runId}:%`)}
      OR COALESCE(reference, '') LIKE ${sqlString(`${runId}-%`)}
      OR COALESCE(external_payment_id, '') LIKE ${sqlString(`${runId}-%`)}
    );

  DELETE FROM public.pending_payments
  WHERE user_id IN (v_user, COALESCE(v_second, v_user))
    AND (
      transaction_reference LIKE ${sqlString(`${runId}-%`)}
      OR ercas_reference LIKE ${sqlString(`${runId}-%`)}
    );

  UPDATE public.profiles
  SET wallet_balance = 0,
      account_suspended = false,
      suspension_reason = null,
      suspended_at = null,
      updated_at = now()
  WHERE id IN (v_user, COALESCE(v_second, v_user));

  PERFORM set_config('app.tally_wallet_engine_authorized', 'false', true);
  PERFORM set_config('app.tally_profile_privileged_authorized', 'false', true);
END $$;
`
}

async function runConcurrent(items) {
  return Promise.all(items.map(([label, sql]) => runPsqlAsync(label, sql)))
}

function runPsql(label, sql) {
  const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      PSQLRC: '',
    },
  })
  return {
    label,
    ok: result.status === 0,
    exitCode: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
    stdoutTail: sanitizeOutput(result.stdout),
    stderrTail: result.error?.code === 'ETIMEDOUT'
      ? `psql timed out after ${timeoutMs}ms`
      : sanitizeOutput(result.stderr),
  }
}

function runPsqlAsync(label, sql) {
  return new Promise((resolve) => {
    const child = spawn('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], {
      env: {
        ...process.env,
        PSQLRC: '',
      },
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      resolve({
        label,
        ok: false,
        exitCode: null,
        timedOut: true,
        stdoutTail: sanitizeOutput(stdout),
        stderrTail: `psql timed out after ${timeoutMs}ms`,
      })
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        label,
        ok: code === 0,
        exitCode: code,
        timedOut: false,
        stdoutTail: sanitizeOutput(stdout),
        stderrTail: sanitizeOutput(stderr),
      })
    })
  })
}

function summarizeChildren(children) {
  return children.map((child) => ({
    label: child.label,
    ok: child.ok,
    exitCode: child.exitCode,
    timedOut: child.timedOut,
    stdoutTail: child.stdoutTail,
    stderrTail: child.stderrTail,
  }))
}

function output(summary) {
  if (jsonOnly) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }
  console.log(`Wallet DB concurrency test ${summary.ok ? 'passed' : 'failed'}.`)
  console.log(`Environment: ${summary.environment}`)
  console.log(`Test user: ${summary.testUserId}`)
  console.log(`Run id: ${summary.runId}`)
  if (summary.error) console.log(`Error: ${summary.error}`)
  if (summary.checks) {
    console.log('Checks:')
    for (const check of summary.checks) console.log(`- ${check}`)
  }
}

function parseArgs(rawArgs) {
  const parsed = new Map()
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]
    if (arg === '--help' || arg === '-h') {
      parsed.set(arg.replace(/^-+/, ''), 'true')
      continue
    }
    if (!arg.startsWith('--')) continue

    const [key, inlineValue] = arg.slice(2).split('=', 2)
    const value = inlineValue ?? rawArgs[i + 1]
    if (inlineValue == null && value && !value.startsWith('--')) i += 1
    parsed.set(key, value === undefined || value.startsWith('--') ? 'true' : value)
  }
  return parsed
}

function clean(value) {
  return String(value || '').trim()
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function sanitizeOutput(value) {
  return sanitizeOutputWithUrl(value, databaseUrl)
}

function sanitizeOutputWithUrl(value, url) {
  const cleaned = clean(value)
  const redacted = url ? cleaned.replaceAll(url, '[DATABASE_URL_REDACTED]') : cleaned
  return redacted
    .split(/\r?\n/)
    .slice(-60)
    .join('\n')
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function sqlUuidOrNull(value) {
  return value ? `${sqlString(value)}::uuid` : 'NULL::uuid'
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function runSelfTest() {
  const parsed = parseArgs([
    '--test-user-id',
    '11111111-1111-4111-8111-111111111111',
    '--second-test-user-id=22222222-2222-4222-8222-222222222222',
    '--json',
  ])
  const fakeUrl = 'postgres://owner:secret@example.invalid:5432/postgres'
  const sanitized = sanitizeOutputWithUrl(`psql failed for ${fakeUrl}\n${fakeUrl}`, fakeUrl)
  const setupStatement = setupSql()
  const purchaseStatement = purchaseSql('self-test')
  const refundStatement = refundSql('self-test')
  const purchaseVerifyStatement = verifyPurchaseSql()
  const refundVerifyStatement = verifyRefundSql()
  const freezeStatement = freezeDurabilitySql()
  const providerSetupStatement = setupProviderIdentityRaceSql()
  const providerCreditStatement = providerCreditSql('11111111-1111-4111-8111-111111111111', 'self-test')
  const providerVerifyStatement = verifyProviderIdentityRaceSql()
  const cleanupStatement = cleanupSql()

  assertSelf(parsed.get('test-user-id') === '11111111-1111-4111-8111-111111111111', 'parseArgs must read separated option values')
  assertSelf(parsed.get('second-test-user-id') === '22222222-2222-4222-8222-222222222222', 'parseArgs must read inline option values')
  assertSelf(parsed.get('json') === 'true', 'parseArgs must treat bare flags as true')
  assertSelf(isUuid('11111111-1111-4111-8111-111111111111'), 'UUID guard must accept ordinary UUID fixtures')
  assertSelf(!isUuid('not-a-uuid'), 'UUID guard must reject invalid fixture ids')
  assertSelf(sqlString("owner's fixture") === "'owner''s fixture'", 'SQL literal helper must escape single quotes')
  assertSelf(sqlUuidOrNull('11111111-1111-4111-8111-111111111111') === "'11111111-1111-4111-8111-111111111111'::uuid", 'UUID helper must cast supplied UUIDs')
  assertSelf(sqlUuidOrNull('') === 'NULL::uuid', 'UUID helper must emit NULL for optional second fixture')
  assertSelf(!sanitized.includes(fakeUrl), 'sanitized output must redact database URL')
  assertSelf(sanitized.includes('[DATABASE_URL_REDACTED]'), 'sanitized output must include the redaction marker')
  assertSelf(setupStatement.includes('INSERT INTO public.pending_payments'), 'setup SQL must seed server-owned pending payment evidence')
  assertSelf(setupStatement.includes("'verified_amount_ngn', 1000"), 'setup SQL must seed verified amount metadata for the trusted topup')
  assertSelf(setupStatement.includes('public.apply_wallet_transaction'), 'setup SQL must seed principal through the wallet engine')
  assertSelf(purchaseStatement.includes("'purchase'"), 'purchase race SQL must post a purchase through the wallet engine')
  assertSelf(purchaseStatement.includes('source_order_id'), 'purchase race SQL must bind the order identity')
  assertSelf(refundStatement.includes("'refund'"), 'refund race SQL must post a refund through the wallet engine')
  assertSelf(refundStatement.includes('source_order_id'), 'refund race SQL must link to the original order identity')
  assertSelf(purchaseVerifyStatement.includes('expected exactly one purchase'), 'purchase verification SQL must assert one race winner')
  assertSelf(refundVerifyStatement.includes('expected exactly one refund'), 'refund verification SQL must assert one race winner')
  assertSelf(freezeStatement.includes('WALLET_UNBACKED_FUNDS'), 'freeze durability SQL must assert the unbacked-funds denial code')
  assertSelf(freezeStatement.includes('account_suspended'), 'freeze durability SQL must verify account suspension persists')
  assertSelf(freezeStatement.includes('denied unbacked purchase inserted'), 'freeze durability SQL must verify denied purchases do not create ledger rows')
  assertSelf(providerSetupStatement.includes(`${runId}-shared-provider`), 'provider race setup SQL must seed one shared provider identity')
  assertSelf(providerCreditStatement.includes("'provider_identity'"), 'provider credit SQL must mark the provider identity race')
  assertSelf(providerCreditStatement.includes("'verified_amount_ngn', 500"), 'provider credit SQL must include verified amount metadata')
  assertSelf(providerVerifyStatement.includes('expected one shared provider payment credit'), 'provider verification SQL must assert one shared provider credit')
  assertSelf(providerVerifyStatement.includes('expected combined wallet balance 500 after shared provider race'), 'provider verification SQL must assert final combined balance')
  assertSelf(cleanupStatement.includes('DELETE FROM public.transactions') && cleanupStatement.includes('DELETE FROM public.pending_payments'), 'cleanup SQL must remove runner ledger and pending-payment fixtures')

  console.log(JSON.stringify({
    ok: true,
    checks: 28,
    noDatabaseConnection: true,
    realConcurrencyStillRequiresPsql: true,
  }, null, 2))
}

function assertSelf(condition, message) {
  if (!condition) throw new Error(`self-test failed: ${message}`)
}

function printHelp() {
  console.log(`Run committed staging/local wallet concurrency tests with real psql sessions.

Usage:
  TALLYSTORE_DB_TEST_ENV=staging \\
  TALLYSTORE_DB_CONCURRENCY_ACK=I_UNDERSTAND_COMMITTED_TEST_WALLET_MUTATIONS \\
  SUPABASE_DB_URL=postgres://... \\
  npm run security:wallet:db-concurrency -- --test-user-id <ordinary-customer-uuid>

Options:
  --test-user-id <uuid>  Required ordinary non-admin/non-staff profile id.
  --second-test-user-id <uuid>
                         Optional second ordinary profile id. When supplied,
                         the runner also tests one provider payment identity
                         racing across two wallets.
  --json                 Output a JSON result.
  --self-test            Validate local runner helpers without connecting to DB.

Timeout:
  Set TALLYSTORE_DB_CONCURRENCY_TIMEOUT_MS to override each psql execution
  timeout. Default: 180000ms.

Safety:
  - Refuses production.
  - Requires an explicit committed-mutation acknowledgement.
  - Requires an owner-controlled ordinary test customer.
  - Seeds only the supplied test customer with a verified test top-up.
  - Runs two concurrent purchase calls and two concurrent refund calls through
    apply_wallet_transaction, then verifies committed ledger/profile state.
  - With --second-test-user-id, seeds two pending-payment rows with the same
    provider payment identity and verifies only one wallet credit can commit.
  - Verifies an unbacked purchase denial durably freezes the wallet and inserts
    no purchase ledger row before cleanup resets the fixture.
  - Performs best-effort cleanup of this run's test ledger and pending-payment
    rows and resets the supplied test wallet(s) to zero.
`)
}
