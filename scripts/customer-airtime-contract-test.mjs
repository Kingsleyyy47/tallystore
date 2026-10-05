// Pure synthetic contract tests. No provider token, live customer or paid call.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../supabase/functions/_shared/customer-airtime-contract.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const exports = {}
vm.runInNewContext(compiled, { exports })
const { e164, checkedOperators, productOptions, chooseUnit, verifiedAirtimeDelivery, safeMoney } = exports

assert.equal(e164('+447911123456'), '+447911123456')
assert.equal(e164('07911123456'), null)
assert.equal(safeMoney(19.99), 19.99)
const phone = '+447911123456'
const operators = checkedOperators({ data: { phone_number: phone, operators: [{ id: 'vodafone-uk', name: 'Vodafone' }] } }, phone)
assert.equal(operators.length, 1)
assert.equal(checkedOperators({ data: { phone_number: '+15551234567', operators: [{ id: 'vodafone-uk', name: 'Vodafone' }] } }, phone).length, 0)
assert.equal(checkedOperators({ operator_found: true, data: [{ id: 'vodafone-uk', name: 'Vodafone', country: 'GB', recipient_type: 'phone_number' }] }, phone).length, 1,
  'live Bitrefill shape returns products directly, without a phone echo')
assert.equal(checkedOperators({ operator_found: false, data: [{ id: 'vodafone-uk', name: 'Vodafone', country: 'GB', recipient_type: 'phone_number' }] }, phone).length, 0)
assert.equal(checkedOperators({ operator_found: true, data: [{ id: 'vodafone-uk', name: 'Vodafone', country: 'GB', recipient_type: 'email' }] }, phone).length, 0)

const product = { data: { id: 'vodafone-uk', name: 'Vodafone', recipient_type: 'phone_number', currency: 'GBP', country: 'GB',
  packages: [{ id: 'vodafone-uk<&>25', value: 25, amount: 25, price: 29038 }] } }
const options = productOptions(product, 'vodafone-uk')
assert.ok(options)
assert.equal(options.country_code, 'GB')
assert.equal(chooseUnit(options, 'vodafone-uk<&>25', undefined).provider_price, 29038)
assert.equal(chooseUnit(options, 'vodafone-uk<&>25', 35), null)
assert.equal(productOptions({ data: { ...product.data, recipient_type: 'email' } }, 'vodafone-uk'), null)
assert.equal(productOptions({ data: { ...product.data, type: 'gift_card' } }, 'vodafone-uk'), null)
assert.equal(productOptions({ data: { ...product.data, packages: [{ id: 'a', package_id: 'b', value: 25, price: 29038 }] } }, 'vodafone-uk'), null)

const quote = { product_id: 'vodafone-uk', product_name: 'Vodafone', operator_id: 'vodafone-uk', operator_name: 'Vodafone',
  country_code: 'GB', recipient_phone: phone, package_id: 'vodafone-uk<&>25', unit_value: 25, currency: 'GBP', amount_ngn: 42000 }
const invoice = { data: { id: 'invoice-123', status: 'complete', currency: 'BTC', orders: [{ id: 'order-123' }] } }
const detail = { data: { id: 'order-123', status: 'delivered', product: { id: 'vodafone-uk', value: 25 }, phone_number: phone } }
const evidence = verifiedAirtimeDelivery(invoice, detail, 'invoice-123', quote)
assert.equal(evidence?.provider_status, 'complete', 'phone delivery needs no redemption code')
assert.equal(evidence?.recipient_phone, phone)
for (const wrong of [
  { ...detail, data: { ...detail.data, phone_number: '+15551234567' } },
  { ...detail, data: { ...detail.data, product: { id: 'vodafone-uk', value: 50 } } },
  { ...detail, data: { ...detail.data, status: 'processing' } },
]) assert.equal(verifiedAirtimeDelivery(invoice, wrong, 'invoice-123', quote), null)
assert.equal(verifiedAirtimeDelivery({ data: { ...invoice.data, orders: [{ id: 'order-123' }, { id: 'order-456' }] } }, detail, 'invoice-123', quote), null)
assert.equal(verifiedAirtimeDelivery({ data: { ...invoice.data, status: 'pending' } }, detail, 'invoice-123', quote), null)
assert.equal(verifiedAirtimeDelivery({ data: { ...invoice.data, orders: [{ id: 'order-123', status: 'failed' }] } }, detail, 'invoice-123', quote), null)
assert.equal(verifiedAirtimeDelivery({ data: { ...invoice.data, orders: [{ id: 'order-123', quantity: 2 }] } }, detail, 'invoice-123', quote), null)
assert.equal(verifiedAirtimeDelivery(invoice, { data: { ...detail.data, product: { ...detail.data.product, currency: 'USD' } } }, 'invoice-123', quote), null)
console.log('customer airtime contract fixtures passed')
