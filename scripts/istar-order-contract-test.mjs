import assert from 'node:assert/strict'
import {
  canonicalIstarAmount, canonicalIstarOrderId, validateIstarOrderReceipt,
} from '../supabase/functions/_shared/istar-order-contract.ts'

const expected = {kind:'stars',username:'recipient_one',quantity:50,
  walletType:'USDT',recipientHash:'recipient_hash_1'}
const good = {order_id:'4820',status:'processing',username:'recipient_one',
  quantity:50,wallet_type:'USDT',amount:0.5}
assert.equal(canonicalIstarOrderId('0004820'),'4820')
assert.equal(canonicalIstarOrderId(4820),'4820')
assert.equal(canonicalIstarOrderId('550e8400-e29b-41d4-a716-446655440000'),
  '550e8400-e29b-41d4-a716-446655440000')
for(const bad of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'0','../4820','https://evil.invalid','1e4',''])
  assert.equal(canonicalIstarOrderId(bad),null)
assert.equal(canonicalIstarAmount('000.5000'),'0.5')
assert.equal(canonicalIstarAmount(0.5),'0.5')
for(const bad of [0,-1,Infinity,NaN,'0','-1','1e2','5 USD','0.1234567890123456789'])
  assert.equal(canonicalIstarAmount(bad),null)
assert.deepEqual(validateIstarOrderReceipt(good,expected),{
  orderId:'4820',status:'processing',username:'recipient_one',
  walletType:'USDT',amount:'0.5',quantity:50,
})
assert.equal(validateIstarOrderReceipt({...good,status:'completed',recipient_hash:'recipient_hash_1'},
  {...expected,providerOrderId:'004820',amount:'0.5000'}).status,'completed')
assert.equal(validateIstarOrderReceipt({data:{...good},order_id:'04820',amount:'0.50'},expected)?.orderId,'4820')
for(const change of [
  {order_id:'other'},{id:'4930'},{status:'delivered'},{username:'other'},
  {quantity:51},{months:3},{wallet_type:'TON'},{amount:0},
  {amount:Infinity},{recipient_hash:'other'},{recipient:'other'},
  {order_type:'premium'},
]) assert.equal(validateIstarOrderReceipt({...good,...change},expected),null,
  `unexpected provider claim ${Object.keys(change)[0]}`)
for(const change of [
  {providerOrderId:'4930'},{amount:'0.500000000000000001'},
  {username:'other'},{quantity:51},{walletType:'TON'},
]) assert.equal(validateIstarOrderReceipt(good,{...expected,...change}),null)
assert.equal(validateIstarOrderReceipt({...good,recipient_hash:'recipient_hash_1',recipient:'other'},
  expected),null)
assert.equal(validateIstarOrderReceipt({data:{...good},amount:0.6},expected),null)
assert.equal(validateIstarOrderReceipt({order:{...good},username:'other'},expected),null)
// Legacy payload claims cannot contradict the flat authoritative Order, or
// disappear when handlers normalize the receipt before saving it.
const matchingPayload = {username:expected.username,recipient:expected.recipientHash,
  quantity:50,wallet_type:'USDT',amount:'0.5000',order_type:'star'}
for (const wrap of [
  payload => ({...good,payload}),
  payload => ({data:{...good,payload}}),
  payload => ({order:{...good,payload}}),
]) {
  assert.equal(validateIstarOrderReceipt(wrap(matchingPayload),expected)?.orderId,'4820')
  for (const change of [
    {order_id:'4930'},{id:'4930'},{status:'failed'},{username:'other_user'},
    {recipient:'other_hash'},{recipient_hash:'other_hash'},{quantity:999},
    {months:3},{wallet_type:'TON'},{amount:'99'},{order_type:'premium'},
  ]) assert.equal(validateIstarOrderReceipt(wrap({...matchingPayload,...change}),expected),null,
    `conflicting payload claim ${Object.keys(change)[0]}`)
  for (const malformed of [[], 'not-an-object', 1])
    assert.equal(validateIstarOrderReceipt(wrap(malformed),expected),null)
}
assert.equal(validateIstarOrderReceipt({...good,recipient:{}},
  {...expected,recipientHash:undefined}),null)
const premium={order_id:'550e8400-e29b-41d4-a716-446655440000',status:'pending',
  username:'recipient_one',months:3,wallet_type:'TON',amount:'0.125'}
assert.equal(validateIstarOrderReceipt(premium,{kind:'premium',username:'recipient_one',
  months:3,walletType:'TON',amount:'0.1250'})?.amount,'0.125')
assert.equal(validateIstarOrderReceipt({...premium,quantity:50},{kind:'premium',username:'recipient_one',
  months:3,walletType:'TON'}),null)
console.log('iStar order contract: documented identity, amount, currency, status and conflicting optional claims passed.')
