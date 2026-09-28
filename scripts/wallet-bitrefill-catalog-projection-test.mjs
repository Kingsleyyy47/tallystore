import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../supabase/functions/bitrefill-catalog/index.ts', import.meta.url), 'utf8')
const start = source.indexOf('function publicBitrefillProduct(')
const end = source.indexOf('export interface BitrefillInvoiceItem', start)
assert(start >= 0 && end > start, 'Bitrefill public catalog projection missing')
assert.match(source, /data: publicBitrefillCatalog\(result, action\)/)
assert.doesNotMatch(source, /data: result,\s*\}\)/)

const helpers = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const { publicBitrefillCatalog } = runInNewContext(
  `${helpers}\n({ publicBitrefillCatalog })`,
)

const rawProduct = {
  product_id: 'gift-1', name: 'Gift Card', countries: ['GB'], currency: 'GBP',
  recipient_type: 'email',
  packages: [{ package_id: 'ten', value: 10, provider_margin: 0.3 }],
  range: { min: 5, max: 50, step: 5, wholesale_cost: 4.2 },
  wholesale_price: 8.5,
  provider_response: { private_token: 'private-provider-token' },
}
const list = publicBitrefillCatalog({
  data: [rawProduct],
  meta: { _next: 'next-page', provider_internal: 'private-pagination-detail' },
}, 'search')
const detail = publicBitrefillCatalog(rawProduct, 'details')
for (const response of [list, detail]) {
  const encoded = JSON.stringify(response)
  for (const privateValue of ['wholesale_cost', 'wholesale_price', 'provider_margin', 'provider_response', 'private-provider-token']) {
    assert.equal(encoded.includes(privateValue), false, `Bitrefill catalog exposed ${privateValue}`)
  }
}
assert.equal(list.data[0].product_id, 'gift-1')
assert.equal(list.data[0].packages[0].value, 10)
assert.equal(list.meta._next, 'next-page')
assert.equal(detail.range.min, 5)
assert.deepEqual(Object.keys(detail).sort(), [
  'countries', 'currency', 'name', 'packages', 'product_id', 'range', 'recipient_type',
])
const malformed = publicBitrefillCatalog({
  ...rawProduct,
  countries: ['GB', { private: 'private-country-detail' }],
  currency: { private: 'private-currency-detail' },
  packages: [{ package_id: 'ten', value: 10 }, { package_id: { private: true }, value: 20 }],
}, 'details')
assert.equal(JSON.stringify(malformed).includes('private-'), false)
assert.equal(malformed.countries.length, 1)
assert.equal(malformed.packages.length, 1)
assert.equal(malformed.currency, null)

console.log('Bitrefill catalog list, search, and details project only customer-safe fields.')
