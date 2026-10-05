import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { FunctionsHttpError } from '@supabase/supabase-js';

const source = fs.readFileSync('src/lib/socialBoostFunctionError.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, {
  exports, Response, Uint8Array, TextDecoder, setTimeout, clearTimeout,
});
const { readSocialBoostFunctionError: read } = exports;
const jsonError = (body, status = 400) => new FunctionsHttpError(new Response(JSON.stringify(body), { status }));
const fallback = await read(new Error('Edge Function returned a non-2xx status code'), 'purchase');
assert.match(fallback, /Check your order history before placing it again/);
assert.doesNotMatch(fallback, /non-2xx/);

const insufficient = jsonError({ error: 'Insufficient verified funds for purchase' });
assert.equal(await read(insufficient, 'purchase'), 'Insufficient verified funds for purchase');
assert.equal(insufficient.context.bodyUsed, false, 'decode must leave original SDK response untouched');
assert.deepEqual(await insufficient.context.json(), { error: 'Insufficient verified funds for purchase' });
assert.match(await read(jsonError({ code: 'SMM_ORDERS_PAUSED', error: 'private payload' }, 503), 'purchase'), /temporarily paused/);
assert.match(await read(jsonError({ code: 'SMM_SUPPLIER_OUTCOME_UNKNOWN' }, 409), 'purchase'), /do not place it again/);
for (const code of ['SMM_DISPATCH_STATUS_UNCONFIRMED', 'SMM_DEBIT_PROOF_UNCONFIRMED', 'SMM_LOCAL_ORDER_UNCONFIRMED']) {
  assert.match(await read({ code, error: 'private detail' }, 'purchase'), /do not place it again/);
}
assert.match(await read(jsonError({ code: 'SMM_PURCHASE_LEDGER_ORPHANED' }, 409), 'purchase'), /support review/);
assert.match(await read(jsonError({ code: 'IDEMPOTENCY_REQUEST_CONFLICT' }, 409), 'purchase'), /already used/);
assert.match(await read(jsonError({ error: 'private auth payload' }, 401), 'purchase'), /sign in again/);
assert.match(await read(jsonError({ error: 'private policy payload' }, 403), 'purchase'), /not permitted/);
assert.equal(await read(jsonError({ error: 'Minimum quantity is 100' }), 'purchase'), 'Minimum quantity is 100');
assert.equal(await read(jsonError({ error: 'Maximum quantity is 200' }), 'purchase'), 'Maximum quantity is 200');
assert.equal(await read({ error: 'Price changed. Please refresh and try again.' }, 'purchase'), 'Price changed. Please refresh and try again.');
assert.match(await read(new Error('Unauthorized'), 'purchase'), /sign in again/);
assert.equal(await read(jsonError({ error: 'Order not found' }, 404), 'status'), 'Order not found');

for (const value of [
  'new row for relation orders violates check constraint orders_status_check',
  'SMM API error: invalid key secret-example',
  'Minimum quantity is 10; database password=secret-example',
  'Could not update SMM order: private database detail',
  'Failed to send a request to the Edge Function',
]) {
  assert.equal(await read(jsonError({ error: value }), 'purchase'), fallback);
  assert.equal(await read(new Error(value), 'purchase'), fallback);
}
assert.equal(await read(jsonError({ message: 'Edge Function returned a non-2xx status code' }), 'purchase'), fallback);
assert.equal(await read(new FunctionsHttpError(new Response('<html>gateway unavailable</html>', { status: 502 })), 'purchase'), fallback);
assert.equal(await read(jsonError(null), 'purchase'), fallback);
assert.equal(await read(jsonError(['Unauthorized']), 'purchase'), fallback);
assert.equal(await read(jsonError({ error: 'x'.repeat(20_000) }), 'purchase'), fallback);
assert.equal(await read(new FunctionsHttpError(new Response(null, { status: 503 })), 'purchase'), fallback);

const consumedResponse = new Response(JSON.stringify({ error: 'Insufficient verified funds for purchase' }), { status: 400 });
await consumedResponse.text();
assert.equal(await read(new FunctionsHttpError(consumedResponse), 'purchase'), fallback, 'consumed response should fail safely');

const brokenStream = new ReadableStream({ start(controller) { controller.error(new Error('private stream failure')); } });
assert.equal(await read(new FunctionsHttpError(new Response(brokenStream, { status: 502 })), 'purchase'), fallback);

// Deadline covers the whole body, including a response that stops after its first chunk.
const stalledStream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } });
const start = performance.now();
assert.equal(await read(new FunctionsHttpError(new Response(stalledStream, { status: 502 })), 'purchase'), fallback);
assert.ok(performance.now() - start < 2_500, 'a hanging response must not leave the checkout busy indefinitely');
assert.match(await read(new Error('private failure'), 'status'), /status is temporarily unavailable/);

const page = fs.readFileSync('src/pages/SocialBoostPage.tsx', 'utf8');
assert.ok(!page.includes('error.context?.body'), 'the SDK response body is a stream, not decoded JSON');
assert.ok(page.includes("await readSocialBoostFunctionError(err, 'purchase')"));
assert.ok(page.includes("await readSocialBoostFunctionError(err, 'status')"));
assert.ok(!page.includes("console.error('Order error:', err)"), 'do not log raw provider/error context to customers');
console.log('Social Boost errors: actual SDK Response JSON, safe business/auth messages, unknown outcome guidance, redaction, bounded malformed/oversized/hanging responses passed.');
