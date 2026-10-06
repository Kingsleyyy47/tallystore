import assert from 'node:assert/strict'
import { preparePartnerSmsPlan, preparePartnerSocialPlan } from '../supabase/functions/_shared/partner-sms-social.ts'

const key = 'secret-that-must-never-appear'
const uuid = '3b38ef31-b4c3-4f87-8d53-ecddad9eaefe'
const partner = { markup_percent: 10 }
const calls = []
let response = new Response('NO_NUMBERS')
let throwing = false
const fetchImpl = async (url, options) => {
  calls.push({ url: String(url), options })
  if (throwing) throw new Error('provider timeout with secret-that-must-never-appear')
  return response
}
const env = (name) => name === 'DAISYSMS_API_KEY' || name === 'SMM_PANEL_API_KEY' ? key : undefined
const smsDeps = {
  smsCatalogue: async () => [{ id: 'go', name: 'Google', availability: 'available', live_verified: true, provider_cost_usd: 0.5, stock: { available_quantity: 3 }, price_ngn: 1500 }],
  getNgnUsdRate: async () => 1500, fetchImpl, env, timeoutMs: 50,
}
const socialService = {
  id: uuid, external_id: 123, name: 'Followers', service_type: 'Default',
  price_ngn: 1000, rate_usd: 0.2, min_quantity: 100, max_quantity: 10000, is_active: true,
}
const admin = {
  from(table) {
    assert.equal(table, 'smm_services')
    return { select() { return this }, eq() { return this }, async maybeSingle() { return { data: socialService, error: null } } }
  },
}
const socialDeps = {
  SMM_TYPES_WITH_QUANTITY: ['Default'], fetchImpl, env, timeoutMs: 50,
  smmOrderParams(service, body, qty) {
    return { action: 'add', service: Number(service.external_id), link: String(body.link), quantity: qty }
  },
}

const sms = await preparePartnerSmsPlan(admin, partner, { item_id: 'go' }, smsDeps)
assert.equal(sms.amountNgn, 1500)
assert.deepEqual(sms.requestPayload, { item_id: 'go', quantity: 1 })
assert.equal(JSON.stringify(sms).includes(key), false)
assert.deepEqual(await sms.dispatch(uuid), { kind: 'rejected', reason: 'NO_STOCK' })
assert.equal(calls.length, 1)
assert.equal(new URL(calls[0].url).searchParams.get('max_price'), '0.5000')
assert.equal(new URL(calls[0].url).searchParams.get('action'), 'getNumber')

for (const [body, expected] of [
  ['NO_MONEY', 'INSUFFICIENT_BALANCE'], ['MAX_PRICE_EXCEEDED', 'PRICE_CHANGED'],
]) {
  response = new Response(body)
  assert.deepEqual(await sms.dispatch(uuid), { kind: 'rejected', reason: expected })
}
response = new Response('ACCESS_NUMBER:12345:15551234567')
assert.deepEqual(await sms.dispatch(uuid), {
  kind: 'accepted', source: 'daisy', id: '12345', status: 'active',
  payload: { service_name: 'Google', phone_number: '+15551234567', raw_phone_number: '15551234567', provider_order_id: '12345' },
})
for (const body of ['ACCESS_NUMBER:0:15551234567', 'ACCESS_NUMBER:123:bad', 'BAD_KEY', '{bad json']) {
  response = new Response(body)
  assert.deepEqual(await sms.dispatch(uuid), { kind: 'unknown' })
}
response = new Response('NO_NUMBERS', { status: 503 })
assert.deepEqual(await sms.dispatch(uuid), { kind: 'unknown' })
throwing = true
assert.deepEqual(await sms.dispatch(uuid), { kind: 'unknown' })
throwing = false
const timedSms = await preparePartnerSmsPlan(admin, partner, { item_id: 'go' }, {
  ...smsDeps, timeoutMs: 5,
  fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  }),
})
const keepAlive = setTimeout(() => {}, 50)
try { assert.deepEqual(await timedSms.dispatch(uuid), { kind: 'unknown' }) }
finally { clearTimeout(keepAlive) }
const beforeInvalid = calls.length
await assert.rejects(preparePartnerSmsPlan(admin, partner, { item_id: 'go', quantity: '1.5' }, smsDeps))
await assert.rejects(preparePartnerSmsPlan(admin, partner, { item_id: 'go' }, {
  ...smsDeps, smsCatalogue: async () => [{ id: 'go', availability: 'available', stock: { available_quantity: 3 }, price_ngn: 1500, provider_cost_usd: 0.5 }],
}))
assert.equal(calls.length, beforeInvalid)

// A paid GET can finish after a local timeout. Never treat the absence of a
// response as a rejection, retain a late body, or send another purchase.
let lateSmsCancelled = false
let lateSmsCalls = 0
const lateSms = await preparePartnerSmsPlan(admin, partner, { item_id: 'go' }, {
  ...smsDeps, timeoutMs: 5, fetchImpl: async (_url, options) => {
    lateSmsCalls++
    assert.equal(options.redirect, 'error')
    assert.equal(options.credentials, 'omit')
    await new Promise(resolve => setTimeout(resolve, 25))
    return new Response(new ReadableStream({ cancel() { lateSmsCancelled = true } }))
  },
})
assert.deepEqual(await lateSms.dispatch(uuid), { kind: 'unknown' })
await new Promise(resolve => setTimeout(resolve, 35))
assert.equal(lateSmsCancelled, true)
assert.equal(lateSmsCalls, 1)
let smsBodyCancelled = false
const oversizedSms = await preparePartnerSmsPlan(admin, partner, { item_id: 'go' }, {
  ...smsDeps, fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(32_769)) },
    cancel() { smsBodyCancelled = true },
  })),
})
assert.deepEqual(await oversizedSms.dispatch(uuid), { kind: 'unknown' })
assert.equal(smsBodyCancelled, true, 'SMS limit applies to actual bytes, not just headers')

const body = { item_id: uuid, quantity: 200, link: 'https://example.com/post/1' }
const social = await preparePartnerSocialPlan(admin, partner, body, socialDeps)
assert.equal(social.amountNgn, 220)
assert.deepEqual(social.requestPayload, body)
assert.equal(JSON.stringify(social).includes(key), false)
response = new Response(JSON.stringify({ order: 77 }), { headers: { 'Content-Type': 'application/json' } })
assert.deepEqual(await social.dispatch(uuid), {
  kind: 'accepted', source: 'smm', id: '77', status: 'processing', payload: { provider_order_id: '77' },
})
const form = new URLSearchParams(calls.at(-1).options.body)
assert.equal(form.get('key'), key)
assert.equal(form.get('quantity'), '200')
assert.equal(form.get('link'), body.link)
assert.equal(calls.at(-1).options.credentials, 'omit')
for (const result of [{ order: 0 }, { order: -1 }, { order: 'not-an-order' }, { error: 'No funds', order: 1 }]) {
  response = new Response(JSON.stringify(result))
  assert.deepEqual(await social.dispatch(uuid), { kind: 'unknown' })
}
response = new Response('{invalid')
assert.deepEqual(await social.dispatch(uuid), { kind: 'unknown' })
response = new Response('oops', { status: 500 })
assert.deepEqual(await social.dispatch(uuid), { kind: 'unknown' })
throwing = true
assert.deepEqual(await social.dispatch(uuid), { kind: 'unknown' })
throwing = false
const beforeBadSocial = calls.length
for (const invalid of [
  { ...body, quantity: 1.5 }, { ...body, quantity: 0 }, { ...body, quantity: 10001 },
  { ...body, link: '' }, { ...body, link: 'javascript:alert(1)' },
]) await assert.rejects(preparePartnerSocialPlan(admin, partner, invalid, socialDeps))
assert.equal(calls.length, beforeBadSocial)

let hangingSocialCancelled = false
let hangingSocialCalls = 0
const hangingSocial = await preparePartnerSocialPlan(admin, partner, body, {
  ...socialDeps, timeoutMs: 5, fetchImpl: async () => {
    hangingSocialCalls++
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{')) },
      cancel() { hangingSocialCancelled = true },
    }))
  },
})
assert.deepEqual(await hangingSocial.dispatch(uuid), { kind: 'unknown' })
assert.equal(hangingSocialCancelled, true, 'Social response body is covered by the request deadline')
assert.equal(hangingSocialCalls, 1, 'uncertain paid POST is never retried')
let socialBodyCancelled = false
const oversizedSocial = await preparePartnerSocialPlan(admin, partner, body, {
  ...socialDeps, fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(262_145)) },
    cancel() { socialBodyCancelled = true },
  })),
})
assert.deepEqual(await oversizedSocial.dispatch(uuid), { kind: 'unknown' })
assert.equal(socialBodyCancelled, true)

socialService.service_type = 'Mentions Media Likers'
const mediaPlan = await preparePartnerSocialPlan(admin, partner, { ...body, media: 'https://example.com/reel/1' }, {
  ...socialDeps, SMM_TYPES_WITH_QUANTITY: ['Mentions Media Likers'],
})
response = new Response(JSON.stringify({ order: 88 }))
assert.equal((await mediaPlan.dispatch(uuid)).kind, 'accepted')
assert.equal(new URLSearchParams(calls.at(-1).options.body).get('media'), 'https://example.com/reel/1')
await assert.rejects(preparePartnerSocialPlan(admin, partner, body, { ...socialDeps, SMM_TYPES_WITH_QUANTITY: ['Mentions Media Likers'] }))

socialService.service_type = 'Poll'
const pollPlan = await preparePartnerSocialPlan(admin, partner, { ...body, answer_number: 2 }, socialDeps)
assert.equal(pollPlan.amountNgn, 1100)
response = new Response(JSON.stringify({ order: 89 }))
assert.equal((await pollPlan.dispatch(uuid)).kind, 'accepted')
assert.equal(new URLSearchParams(calls.at(-1).options.body).get('answer_number'), '2')
assert.equal(new URLSearchParams(calls.at(-1).options.body).get('quantity'), '200')
await assert.rejects(preparePartnerSocialPlan(admin, partner, { ...body, answer_number: 2, quantity: 1001 }, socialDeps))

socialService.service_type = 'Subscriptions'
await assert.rejects(preparePartnerSocialPlan(admin, partner, { ...body, username: 'someone', posts: 2 }, socialDeps))
socialService.service_type = 'Web Traffic'
await assert.rejects(preparePartnerSocialPlan(admin, partner, body, socialDeps))
socialService.service_type = 'Custom Comments'
await assert.rejects(preparePartnerSocialPlan(admin, partner, {
  item_id: uuid, link: body.link, comments: Array(1001).fill('x').join('\n'),
}, socialDeps))

for (const outcome of [await sms.dispatch(uuid), await social.dispatch(uuid)]) {
  assert.equal(JSON.stringify(outcome).includes(key), false)
  assert.equal(JSON.stringify(outcome).includes('secret-that-must-never-appear'), false)
}
console.log('Partner SMS/Social adapters: bounded single dispatch, strict quote/fields, acceptance and unknown outcome tests passed.')
