import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20260925009000_restrict_telegram_order_browser_reads.sql', import.meta.url), 'utf8')
const edgeSource = readFileSync(new URL('../supabase/functions/telegram-stars/index.ts', import.meta.url), 'utf8')
const browserSource = readFileSync(new URL('../src/pages/TelegramStarsPage.tsx', import.meta.url), 'utf8')
const db = new PGlite()

async function denied(sql) {
  await assert.rejects(() => db.query(sql), (error) => error.code === '42501')
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE public.telegram_orders (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, status text,
      recipient_hash text, istar_amount numeric, idempotency_key text
    );
    CREATE TABLE public.telegram_products (
      id uuid PRIMARY KEY, label text, months integer, price_ngn numeric,
      supplier_product_id text, supplier_cost numeric
    );
    INSERT INTO public.telegram_orders VALUES
      ('11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222', 'completed',
       'supplier-recipient-hash', 3.5, 'private-request-key');
    GRANT ALL ON public.telegram_orders TO PUBLIC, anon, authenticated;
    GRANT ALL ON public.telegram_products TO PUBLIC, anon, authenticated;
    GRANT SELECT (recipient_hash), SELECT (istar_amount)
      ON public.telegram_orders TO PUBLIC, authenticated;
    GRANT SELECT (supplier_cost) ON public.telegram_products TO PUBLIC, authenticated;
    ALTER TABLE public.telegram_orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY unsafe_telegram_read ON public.telegram_orders
      FOR SELECT TO anon, authenticated USING (true);
  `)
  await db.exec(migration)

  for (const role of ['anon', 'authenticated']) {
    const grants = await db.query(`
      SELECT has_table_privilege('${role}', 'public.telegram_orders', 'SELECT') AS table_read,
        has_column_privilege('${role}', 'public.telegram_orders', 'id', 'SELECT') AS id_read,
        has_column_privilege('${role}', 'public.telegram_orders', 'recipient_hash', 'SELECT') AS recipient_hash_read,
        has_column_privilege('${role}', 'public.telegram_orders', 'istar_amount', 'SELECT') AS supplier_amount_read,
        has_table_privilege('${role}', 'public.telegram_orders', 'UPDATE') AS update_order
    `)
    assert.deepEqual(grants.rows[0], {
      table_read: false,
      id_read: false,
      recipient_hash_read: false,
      supplier_amount_read: false,
      update_order: false,
    })
    await db.query(`SET ROLE ${role}`)
    await denied('SELECT id FROM public.telegram_orders')
    await denied('SELECT recipient_hash FROM public.telegram_orders')
    await denied('SELECT id FROM public.telegram_products')
    await denied('SELECT supplier_cost FROM public.telegram_products')
    await db.query('RESET ROLE')
  }

  await db.query('SET ROLE service_role')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.telegram_orders')).rows[0].n, 1)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.telegram_products')).rows[0].n, 0)
  await db.query('RESET ROLE')

  const orderStart = edgeSource.indexOf('function publicTelegramOrder(')
  const recipientStart = edgeSource.indexOf('function publicTelegramRecipient(', orderStart)
  const enabledStart = edgeSource.indexOf('function telegramOrdersEnabled()', recipientStart)
  assert(orderStart >= 0 && recipientStart > orderStart && enabledStart > recipientStart)
  const helpers = edgeSource.slice(orderStart, enabledStart).replace(/: any/g, '')
  const { publicTelegramOrder, publicTelegramRecipient } = new Function(
    `${helpers}; return { publicTelegramOrder, publicTelegramRecipient }`,
  )()
  const publicOrder = publicTelegramOrder({
    id: 'order-id', reference: 'TG-1', order_type: 'stars', username: 'customer',
    quantity: 50, price_ngn: 300, status: 'failed', created_at: '2026-09-25',
    error_message: 'private-provider-error', recipient_hash: 'supplier-hash',
    istar_order_id: 'supplier-id', istar_amount: 3.5,
    idempotency_key: 'private-request-key',
  })
  assert.equal(publicOrder.error_message, 'Order failed. Contact support for details.')
  for (const privateField of ['recipient_hash', 'istar_order_id', 'istar_amount', 'idempotency_key']) {
    assert.equal(Object.hasOwn(publicOrder, privateField), false)
  }
  assert.deepEqual(publicTelegramRecipient({
    recipient: 'usable-recipient', name: 'Recipient', photo: null, myself: false,
    provider_debug: 'private-provider-detail',
  }), { recipient: 'usable-recipient', name: 'Recipient', photo: null, myself: false })

  const retailHandler = edgeSource.slice(edgeSource.indexOf('async function handleGetStarPricing'), edgeSource.indexOf('async function handleSearchRecipientStars'))
  assert.match(retailHandler, /preset_prices: presetPrices/)
  assert.match(retailHandler, /async function handleQuoteStars/)
  assert.doesNotMatch(retailHandler, /data: config|return \{ \.\.\.p,/)
  const quoteHandlers = retailHandler.slice(0, retailHandler.indexOf('async function handleGetPremiumProducts'))
    .replace(/admin: SupabaseAdmin/g, 'admin')
    .replace(/body: Record<string, unknown>/g, 'body')
  const { handleGetStarPricing, handleQuoteStars } = new Function(
    'getStarPricingConfig', 'calculateStarPriceNgn', 'json',
    `${quoteHandlers}; return { handleGetStarPricing, handleQuoteStars }`,
  )(
    async () => ({ supplier_cost: 'private-cost', supplier_key: 'private-key' }),
    (quantity) => quantity * 100,
    (data) => data,
  )
  const presets = await handleGetStarPricing({})
  assert.deepEqual(presets, { success: true, data: {
    preset_prices: { 50: 5000, 150: 15000, 250: 25000, 1000: 100000, 2500: 250000 },
  } })
  assert.equal(JSON.stringify(presets).includes('private-'), false)
  assert.deepEqual(await handleQuoteStars({}, { quantity: 77 }), {
    success: true, data: { quantity: 77, price_ngn: 7700 },
  })
  for (const quantity of [49, 50.5, 1_000_001, 'not-a-number']) {
    await assert.rejects(() => handleQuoteStars({}, { quantity }), /Quantity must be between/)
  }
  assert.match(browserSource, /invokeTg<StarQuote>\('quote_stars'/)
  assert.doesNotMatch(browserSource, /cost_per_star_usdt|markup_tiers|usdt_to_ngn|calcStarPrice/)
  assert.doesNotMatch(browserSource, /\.from\('telegram_orders'\)/)

  console.log('Telegram retail/order responses and direct table reads restricted in isolated PostgreSQL fixture.')
} finally {
  await db.close()
}
