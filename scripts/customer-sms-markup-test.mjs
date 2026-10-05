import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const helper = readFileSync('supabase/functions/_shared/customer-service-pricing.ts', 'utf8')
const module = { exports: {} }
vm.runInNewContext(transformSync(helper, { loader: 'ts', format: 'cjs' }).code, { exports: module.exports, module })
const { customerMarkupPrice, loadSmsMarkupRules } = module.exports
const rule = { mode: 'amount', value: 100, source: 'global', legacy_pricing: false }
assert.equal(customerMarkupPrice(1001, rule), 1110)
assert.equal(customerMarkupPrice(1000, rule), 1100)
assert.equal(customerMarkupPrice(1001, { ...rule, mode: 'percent', value: 10 }), 1110)
assert.equal(customerMarkupPrice(100, { ...rule, mode: 'percent', value: 10 }), 110)
assert.equal(customerMarkupPrice(100, { ...rule, mode: 'percent', value: 10.01 }), 120)
assert.throws(() => customerMarkupPrice(NaN, rule))
assert.throws(() => customerMarkupPrice(1000, { ...rule, value: -1 }))

const sms = readFileSync('supabase/functions/smsbus/index.ts', 'utf8')
const begin = sms.indexOf('function optionalNaira(')
const end = sms.indexOf('async function syncSmsProductSettings(', begin)
assert.ok(begin > 0 && end > begin)
const priceSmsService = vm.runInNewContext(transformSync(sms.slice(begin, end), { loader: 'ts', format: 'cjs' }).code + '\npriceSmsService', { customerMarkupPrice })
assert.equal(priceSmsService(.55, 1500, { price_override_ngn: 1700 }, 700, false, { ...rule, legacy_pricing: true }).priceNgn, 1700)
assert.equal(priceSmsService(.55, 1500, {}, 700, false, { ...rule, legacy_pricing: true }).priceNgn, 1526)
assert.equal(priceSmsService(.55, 1500, { price_override_ngn: 1700 }, 700, false, rule).priceNgn, 930)
assert.equal(priceSmsService(.55, 1500, {}, 700, false, { ...rule, mode: 'percent', value: 10 }).priceNgn, 910)
const batchCalls = []
const admin = { async rpc(name, args) {
  batchCalls.push({ name, args })
  return { error: null, data: { success: true, prices: args.p_selectors.map(s => ({ product_id: s.product_id, ...rule })) } }
} }
const rules = await loadSmsMarkupRules(admin, Array.from({ length: 501 }, (_, i) => `service-${i}`))
assert.equal(rules.size, 501)
assert.equal(batchCalls.length, 2)
assert.equal(batchCalls[0].args.p_selectors.length, 500)
assert.equal(batchCalls[1].args.p_selectors.length, 1)
assert.equal(batchCalls[0].args.p_kind, 'sms')
await assert.rejects(loadSmsMarkupRules({ async rpc() { return { error: null, data: { success: true, prices: [] } } } }, ['signal']))
await assert.rejects(loadSmsMarkupRules({ async rpc() { return { error: {}, data: null } } }, ['signal']))
await assert.rejects(loadSmsMarkupRules({ async rpc() { return { error: null, data: { success: true, prices: [{ product_id: 'different', ...rule }] } } } }, ['signal']))
// Run the actual customer projection against internal catalog data.
const customerBegin = sms.indexOf('async function handleServices(')
const customerEnd = sms.indexOf('\nasync function ', customerBegin + 10)
const handleServices = vm.runInNewContext(transformSync(sms.slice(customerBegin, customerEnd), { loader: 'ts', format: 'cjs' }).code + '\nhandleServices', {
  buildSmsCatalog: async () => ({ products: [{ service_id: 'signal', service_code: 'signal', service_name: 'Signal',
    is_enabled: true, available_count: 10, price_ngn: 930, owner_markup_rule: rule, provider_cost_usd: .55, provider_cost_ngn: 825,
    margin_ngn: 105, pricing_mode: 'owner_markup' }], diagnostics: null }), json: body => body,
})
const publicResult = await handleServices({}, 'synthetic-user')
assert.equal(publicResult.data[0].price_ngn, 930)
for (const key of ['owner_markup_rule', 'provider_cost_usd', 'provider_cost_ngn', 'margin_ngn']) assert.equal(Object.hasOwn(publicResult.data[0], key), false)
console.log('SMS markup: existing prices preserved, new amount/percentage rounded up to ₦10, bounded batch, fail-closed rules, customer projection contains no private pricing.')
