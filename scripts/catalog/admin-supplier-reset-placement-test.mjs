import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('AdminPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const matches = []
function visit(node) {
  if (ts.isJsxExpression(node) && node.expression
    && /^isPartnerOwner\s*&&/.test(node.expression.getText(file))
    && node.expression.getText(file).includes('Retry supplier fallback')) {
    matches.push(node)
  }
  ts.forEachChild(node, visit)
}
visit(file)
assert.equal(matches.length, 1, 'reset control must occur exactly once')

const resetExpression = matches[0].expression.getText(file)
assert.match(resetExpression, /^isPartnerOwner\s*&&\s*editingTemplate\?\.id\s*&&/)
const immediatelyBefore = source.slice(Math.max(0, matches[0].getStart(file) - 900), matches[0].getStart(file))
assert.match(immediatelyBefore, /id="auto_fulfill_enabled"/, 'reset control must follow the template auto-fulfil checkbox')
assert.match(source.slice(matches[0].getEnd(), matches[0].getEnd() + 300), /ShopClone Fallback/)

const compiled = ts.transpileModule(`
  const evaluate = ({ isPartnerOwner, editingTemplate, productGroups, resettingSupplierFallbackId, handleResetSupplierFallback }) => (${resetExpression});
  evaluate;
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText
const evaluate = vm.runInNewContext(compiled, {
  React: { createElement: (type, props, ...children) => ({ type, props, children }) },
  Button: 'Button',
})
const base = { productGroups: [], resettingSupplierFallbackId: null, handleResetSupplierFallback() {} }
assert.ok(!evaluate({ ...base, isPartnerOwner: true, editingTemplate: null }))
assert.ok(!evaluate({ ...base, isPartnerOwner: false, editingTemplate: { id: 'product-1' } }))
assert.ok(!evaluate({ ...base, isPartnerOwner: true, editingTemplate: { id: 'product-1' } }))
const rendered = evaluate({
  ...base,
  isPartnerOwner: true,
  editingTemplate: { id: 'product-1' },
  productGroups: [{ id: 'product-1', auto_fulfill_enabled: true, muabanvia_product_id: 'supplier-product' }],
})
assert.equal(rendered.type, 'div')
assert.equal(rendered.children[0].type, 'Button')
assert.match(String(rendered.children[0].children[0]), /Retry supplier fallback/)
console.log('Admin supplier reset: actual JSX expression safely hides for null template/non-owner and renders only beside mapped template control.')
