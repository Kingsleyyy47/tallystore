import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const cache = new Map()
function moduleAt(path) {
  if (cache.has(path)) return cache.get(path)
  const exports = {}
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { exports, require: specifier => {
    if (specifier === '@/lib/supabase') return { supabase: {} }
    if (specifier === '@/components/CategoryLogo') return { default: ({ name }) => React.createElement('span', { 'data-icon-name': name }) }
    if (specifier === '@/components/ui/button') return { Button: ({ children, ...props }) => React.createElement('button', props, children) }
    if (specifier === '@/contexts/CurrencyContext') return { useCurrency: () => ({ formatPrice: value => `NGN ${value}` }) }
    if (specifier.startsWith('@/lib/')) return moduleAt(`src/lib/${specifier.slice('@/lib/'.length)}.ts`)
    return require(specifier)
  } })
  cache.set(path, exports)
  return exports
}

const { isCustomerSellableProduct: sellable, isCustomerVisibleProduct: visible, canAutoFulfillProduct: fallback } = moduleAt('src/lib/productAvailability.ts')
const { getProductIconName, getCategoryStyle } = moduleAt('src/lib/categoryStyles.ts')
const { evaluateProductEligibility } = moduleAt('src/lib/revenue-os.ts')
const base = { id: 'local', category_id: 'facebook', name: 'Local stock', price: 100, is_active: true, stock_count: 2, is_sellable: true, availability_status: 'AVAILABLE' }
assert.equal(sellable(base), true)
const sold = { ...base, id: 'sold', name: 'Sold inventory', stock_count: 0, availability_status: 'UNAVAILABLE', is_sellable: false }
assert.equal(visible(sold), true)
assert.equal(sellable(sold), false)
const api = { ...base, id: 'api', name: '5 years USA account', stock_count: 0, availability_status: 'UNLIMITED' }
assert.equal(fallback(api), true)
assert.equal(sellable(api), true)
assert.equal(evaluateProductEligibility(api).isSellable, true)
assert.equal(evaluateProductEligibility(sold).isSellable, false)
for (const product of [
  { ...api, is_sellable: false }, { ...api, is_sellable: undefined },
  { ...base, stock_count: 0 }, { ...base, availability_status: 'PAUSED' },
  { ...api, availability_status: 'PREORDER' }, { ...api, availability_status: 'BACKORDER' },
  { ...base, stock_count: NaN },
]) {
  assert.equal(sellable(product), false)
  assert.equal(evaluateProductEligibility(product).isSellable, false)
}
for (const product of [{ ...base, is_active: false }, { ...base, is_active: undefined }, { ...base, price: 0 }, { ...base, price: NaN }, { ...base, price: -10 }]) {
  assert.equal(visible(product), false)
  assert.equal(sellable(product), false)
}
assert.equal(getProductIconName('5 years USA account', 'Facebook'), 'Facebook')
assert.equal(getProductIconName('AGED EUROPE DISCORD account', 'Miscellaneous'), 'AGED EUROPE DISCORD account')
assert.equal(getProductIconName('3 year Reddit account', 'Miscellaneous'), '3 year Reddit account')
assert.equal(getCategoryStyle('Mail.com email account').image, undefined)
assert.ok(getCategoryStyle('Gmail').image.includes('/gmail/'))

const Catalog = moduleAt('src/components/GroupedProductCatalog.tsx').default
const html = renderToStaticMarkup(React.createElement(Catalog, {
  categories: [{ id: 'facebook', name: 'Facebook', is_active: true }],
  products: [base, sold, api, { ...base, id: 'hidden', name: 'Inactive hidden', is_active: false }, { ...base, id: 'invalid', name: 'Invalid hidden', price: -1 }],
  selectedCategory: 'facebook', onBuy() {},
}))
assert.ok(html.includes('Sold inventory'))
assert.ok(html.includes('Sold out'))
assert.ok(html.includes('disabled=""'))
assert.ok(html.includes('Available to order'))
assert.ok(html.includes('data-icon-name="Facebook"'))
assert.equal(html.includes('Inactive hidden'), false)
assert.equal(html.includes('Invalid hidden'), false)
assert.equal((html.match(/>Buy /g) || []).length, 2)
console.log('Catalog UI: local stock and trusted fallback buy states, sold-out visibility, disabled paused/empty states, hidden invalid products and correct icon fallback passed.')
