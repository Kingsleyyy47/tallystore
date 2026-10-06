import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transform } from 'esbuild'

// Exercise the actual gateway transport, with no credentials or network.
const source = readFileSync('supabase/functions/customer-api/index.ts','utf8')
  .replace(/^import .*$/gm,'') + '\nglobalThis.transport = { targetJson, callTarget };'
const compiled = (await transform(source,{loader:'ts',target:'es2022'})).code
let implementation
let sends = 0
const sandbox = {
  Request,Response,Headers,URL,URLSearchParams,TextDecoder,TextEncoder,AbortController,
  setTimeout,clearTimeout,console,serve:()=>{},
  Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://target.example.test':name==='SUPABASE_SERVICE_ROLE_KEY'?'fixture-only':undefined}},
  signCustomerCapability:async()=> 'fixture-capability',
  fetch:async(...args)=>{sends++;return implementation(...args)},
}
vm.runInNewContext(compiled,sandbox)
const { targetJson,callTarget } = sandbox.transport
const identity = {key_id:'fixture-key',user_id:'fixture-user',section:'products'}
const signal = () => new AbortController().signal

assert.equal((await targetJson(Response.json({success:true,text:'₦ 🔑'}),signal())).text,'₦ 🔑')
for (const data of ['null','[]','bad-json']) await assert.rejects(targetJson(new Response(data),signal()))
await assert.rejects(targetJson(new Response(new Uint8Array([0xff])),signal()))
await assert.rejects(targetJson(new Response('{}',{headers:{'content-length':String(32*1024*1024+1)}}),signal()))
await assert.rejects(targetJson(new Response('{}',{headers:{'content-length':'invalid'}}),signal()))
await assert.rejects(targetJson(new Response(new Uint8Array(32*1024*1024+1)),signal()),/too large/)
const redirected = new Response('{}')
Object.defineProperty(redirected,'redirected',{value:true})
await assert.rejects(targetJson(redirected,signal()))
const alreadyAborted = new AbortController();alreadyAborted.abort()
await assert.rejects(targetJson(new Response('{}'),alreadyAborted.signal))

let observed
implementation = async(url,options)=>{
  observed={url,options}
  return Response.json({success:true,order:{id:'owned'}},{status:202})
}
let response = await callTarget(identity,'process-purchase',{quantity:1,idempotency_key:'same-request'},200)
assert.equal(response.status,202)
assert.equal((await response.json()).order.id,'owned')
assert.equal(observed.url,'https://target.example.test/functions/v1/process-purchase')
assert.equal(observed.options.redirect,'error')
assert.equal(observed.options.credentials,'omit')
assert.equal(observed.options.cache,'no-store')
assert.equal(observed.options.signal.aborted,true,'successful transport releases its controller')

let stalledSignal,bodyCancelled=false
implementation = async(_url,options)=>{
  stalledSignal=options.signal
  return new Response(new ReadableStream({start(){},cancel(){bodyCancelled=true}}))
}
const beforeBody=sends
response = await callTarget(identity,'process-purchase',{idempotency_key:'same-request'},20)
assert.equal(response.status,503)
assert.equal((await response.json()).code,'purchase_outcome_unknown')
assert.equal(bodyCancelled,true,'deadline cancels a body that ignores transport abort')
assert.equal(stalledSignal.aborted,true)
assert.equal(sends,beforeBody+1,'uncertain purchase is never resent')

implementation = (_url,options)=>{stalledSignal=options.signal;return new Promise(()=>{})}
const beforeHeaders=sends
response = await callTarget(identity,'process-purchase',{idempotency_key:'same-request'},20)
assert.equal(response.status,503)
assert.equal(stalledSignal.aborted,true)
assert.equal(sends,beforeHeaders+1)

let resolveLate,lateCancelled=false
implementation = ()=>new Promise(resolve=>{resolveLate=resolve})
response = await callTarget(identity,'process-purchase',{idempotency_key:'same-request'},20)
assert.equal(response.status,503)
resolveLate(new Response(new ReadableStream({start(){},cancel(){lateCancelled=true}})))
await new Promise(resolve=>setTimeout(resolve,0))
assert.equal(lateCancelled,true,'late headers do not leave an unconsumed response')
console.log('Customer API target transport: body bounds, UTF-8, redirects, full deadlines, cleanup and no resend passed')
