import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const contractSource = readFileSync('supabase/functions/_shared/smm-order-contract.ts', 'utf8');
const contractCode = ts.transpileModule(contractSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const contract = await import(`data:text/javascript;base64,${Buffer.from(contractCode).toString('base64')}`);
const page = readFileSync('src/pages/SocialBoostPage.tsx', 'utf8');
const ast = ts.createSourceFile('SocialBoostPage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
const visit = node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node); ts.forEachChild(node, visit); };
visit(ast);
const quoteCallback = declarations.get('priceQuote').initializer.arguments[0].getText(ast);
const formCallback = declarations.get('isFormValid').initializer.getText(ast);
const compile = source => ts.transpileModule(`(${source})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const context = vm.createContext({ ...contract, selectedService: null, quantity: '100', comments: '', usernames: '',
  link: 'https://example.invalid/post', linkError: '', username: 'owner', hashtags: '#news', hashtag: '#news',
  keywords: 'technology', answerNumber: '2', groups: 'https://example.invalid/group',
  walletLoading: false, walletBalanceUnavailable: false, walletBalance: 100_000,
  SMM_TYPES_WITH_QUANTITY: contract.SMM_QUANTITY_TYPES, Error, Number,
});
const quoteFromActualUI = vm.runInContext(compile(quoteCallback), context);
const formFromActualUI = vm.runInContext(compile(formCallback), context);
context.calculateTotal = () => context.priceQuote.quote?.amountNgn || 0;
const service = type => ({ service_type: type, price_ngn: 999, min_quantity: 1, max_quantity: 10_000 });
for (const [type, input, amount, quantity] of [
  ['Default', { quantity: '101' }, 101, 101],
  ['SEO', { quantity: '101' }, 101, 101],
  ['Poll', { quantity: '101' }, 101, 101],
  ['Package', {}, 999, 1],
  ['Custom Comments Package', { comments: 'one\ntwo' }, 999, 1],
  ['Custom Comments', { comments: 'one\r\n\n two \n', quantity: '1' }, 2, 2],
  ['Comment Replies', { comments: 'one\ntwo\nthree', quantity: '1' }, 3, 3],
  ['Mentions Custom List', { usernames: 'alice\n bob\n', quantity: '1' }, 2, 2],
]) {
  context.selectedService = service(type);
  Object.assign(context, { quantity: '100', comments: '', usernames: '' }, input);
  context.requiredFields = contract.getSmmOrderContract(type).fields;
  context.priceQuote = quoteFromActualUI();
  assert.equal(context.priceQuote.error, '', type);
  assert.equal(context.priceQuote.quote.amountNgn, amount, type);
  assert.equal(context.priceQuote.quote.quantity, quantity, type);
  const raw = { quantity: context.quantity, comments: context.comments, usernames: context.usernames,
    link: context.link, username: context.username, keywords: context.keywords, answer_number: context.answerNumber };
  const serverFields = contract.validateSmmOrderFields(type, raw);
  const serverQuote = contract.quoteSmmOrder(context.selectedService, { ...serverFields, quantity: raw.quantity });
  assert.equal(serverQuote.amountNgn, context.priceQuote.quote.amountNgn, 'actual UI and handler shared quote must agree');
  assert.equal(serverQuote.quantity, context.priceQuote.quote.quantity);
  assert.equal(formFromActualUI(), true, type);
}
for (const type of ['Subscriptions', 'Mentions Media Likers', 'Web Traffic', 'invented', '__proto__']) {
  assert.equal(contract.getSmmOrderContract(type), null);
  context.selectedService = service(type); context.requiredFields = [];
  context.priceQuote = quoteFromActualUI();
  assert.equal(context.priceQuote.error, contract.SMM_UNAVAILABLE);
  assert.equal(formFromActualUI(), false);
}
for (const quantity of ['1.9', '0', 'not a number', '1e100']) {
  context.selectedService = service('Default'); context.quantity = quantity;
  context.requiredFields = contract.getSmmOrderContract('Default').fields;
  context.priceQuote = quoteFromActualUI();
  assert.equal(context.priceQuote.quote, null); assert.equal(formFromActualUI(), false);
}
assert.throws(() => contract.validateSmmOrderFields('Default', { link: { injection: true } }), /check the order details/);
assert.throws(() => contract.validateSmmOrderFields('Default', { link: 'ftp://example.invalid' }), /valid web link/);
assert.throws(() => contract.validateSmmOrderFields('Custom Comments', { link: context.link, comments: ['not', 'a', 'string'] }), /check the order details/);
assert.throws(() => contract.quoteSmmOrder({ ...service('Custom Comments'), min_quantity: 3 }, { comments: 'one\ntwo' }), /Minimum quantity is 3/);
assert.throws(() => contract.quoteSmmOrder({ ...service('Mentions Custom List'), max_quantity: 1 }, { usernames: 'one\ntwo' }), /Maximum quantity is 1/);
assert.equal(contract.quoteSmmOrder({ ...service('Package'), price_ngn: 99.1 }, {}).amountNgn, 100);
for (const type of ['Poll', 'SEO']) assert.ok(contract.getSmmOrderContract(type).fields.includes('quantity'));
assert.ok(page.includes('aria-disabled={!supported}'));
assert.ok(page.includes("if (!getSmmOrderContract(service.service_type)) return;"));
for (const code of ['SMM_DISPATCH_STATUS_UNCONFIRMED', 'SMM_DEBIT_PROOF_UNCONFIRMED', 'SMM_LOCAL_ORDER_UNCONFIRMED']) {
  assert.ok(page.includes(code), 'all held outcomes must refresh wallet/orders and select history');
}
console.log('SMM pricing: actual UI quote/form callbacks agree with server contract; count-based comments/usernames, packages, SEO/Poll quantities, min/max and malformed/unsupported fail-closed cases passed.');
