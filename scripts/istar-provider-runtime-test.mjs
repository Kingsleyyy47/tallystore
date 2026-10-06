import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles}=await build({entryPoints:['supabase/functions/_shared/istar-provider.ts'],bundle:true,platform:'node',format:'esm',write:false})
const {IStarProvider}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const originalFetch=globalThis.fetch,originalTimer=globalThis.setTimeout
const key='synthetic-private-provider-key'
const client=new IStarProvider({apiKey:key})
let calls=[]
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})
const failure=async task=>{await assert.rejects(task,error=>error.message==='Supplier request unavailable'&&!error.message.includes(key))}
try{
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return json({status:'completed'})}
  assert.throws(()=>new IStarProvider({apiKey:key,baseURL:'https://attacker.example/api'}))
  assert.throws(()=>new IStarProvider({apiKey:key+'\n'}))
  for(const path of ['https://attacker.example/orders/x','//attacker.example/orders/x','/orders/../pay','/orders/x?token=yes',
    '/wallet/balance?wallet_type=USDT&wallet_type=TON','/star/recipient/search?username=alice&quantity=49',
    '/premium/recipient/search?username=alice&months=1','/premium/packages?redirect=yes'])await failure(()=>client.get(path))
  assert.equal(calls.length,0)
  assert.deepEqual(await client.get('/orders/provider-order-1'),{status:'completed'})
  assert.equal(calls[0].url,'https://v1.fragmentapi.com/api/v1/partner/orders/provider-order-1')
  assert.equal(calls[0].init.headers['API-Key'],key)
  assert.equal(calls[0].init.redirect,'error')
  assert.equal(calls[0].init.credentials,'omit')
  assert.equal(calls[0].init.cache,'no-store')
  for(const path of ['/premium/packages','/wallet/balance?wallet_type=USDT',
    '/star/recipient/search?username=alice&quantity=100','/premium/recipient/search?username=alice&months=3'])await client.get(path)
  const body={username:'alice',recipient_hash:'hash_123456',quantity:100,wallet_type:'USDT'}
  const before=calls.length
  await failure(()=>client.post('/orders/star',{...body,url:'https://attacker.example'},'one-order'))
  await failure(()=>client.post('/orders/star',body,'x'.repeat(129)))
  assert.equal(calls.length,before)
  await client.post('/orders/star',body,'one-order')
  assert.equal(calls.at(-1).init.method,'POST')
  assert.deepEqual(JSON.parse(calls.at(-1).init.body),body)
  assert.equal(calls.at(-1).init.headers['Idempotency-Key'],'one-order')
  for(const response of [new Response('private-key:'+key,{status:409}),new Response('not json'),
    new Response('{}',{headers:{'Content-Type':'text/plain'}}),new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'512001'}}),
    new Response(new Uint8Array([255]),{headers:{'Content-Type':'application/json'}})]){
    let count=0
    globalThis.fetch=async()=>{count++;return response}
    await failure(()=>client.post('/orders/star',body,'same-one-order'))
    assert.equal(count,1,'No POST retry even on ambiguous/error response')
  }
  globalThis.fetch=async()=>({ok:true,redirected:true,body:new ReadableStream(),headers:new Headers()})
  await failure(()=>client.get('/premium/packages'))
  let cancelled=false
  globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(300000));controller.enqueue(new Uint8Array(300000))},cancel(){cancelled=true}}),{headers:{'Content-Type':'application/json'}})
  await failure(()=>client.get('/premium/packages'))
  assert.equal(cancelled,true)
  for (const invalid of [
    { status: 409, headers: { 'Content-Type': 'application/json' } },
    { status: 200, headers: { 'Content-Type': 'text/plain' } },
    { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Length': '512001' } },
  ]) {
    let invalidBodyCancelled=false
    globalThis.fetch=async()=>new Response(new ReadableStream({cancel(){invalidBodyCancelled=true}}),invalid)
    await failure(()=>client.get('/premium/packages'))
    assert.equal(invalidBodyCancelled,true,'invalid response headers must cancel unread provider bytes')
  }
  // Accelerate only the actual transport's deadline timers in this fixture.
  globalThis.setTimeout=(fn,ms,...args)=>originalTimer(fn,Math.min(ms,20),...args)
  let stalledSignal,stalledCalls=0
  globalThis.fetch=async(_url,init)=>{stalledCalls++;stalledSignal=init.signal;return new Promise(()=>{})}
  await failure(()=>client.post('/orders/star',body,'one-stalled-post'))
  assert.equal(stalledSignal.aborted,true);assert.equal(stalledCalls,1)
  let bodyCancelled=false
  globalThis.fetch=async(_url,init)=>{stalledSignal=init.signal;return new Response(new ReadableStream({pull(){return new Promise(()=>{})},cancel(){bodyCancelled=true;return new Promise(()=>{})}}),{headers:{'Content-Type':'application/json'}})}
  await failure(()=>client.get('/premium/packages'))
  assert.equal(stalledSignal.aborted,true);assert.equal(bodyCancelled,true)
  let finishLateFetch,lateBodyCancelled=false
  globalThis.fetch=(_url,init)=>{stalledSignal=init.signal;return new Promise(resolve=>{finishLateFetch=resolve})}
  await failure(()=>client.get('/premium/packages'))
  assert.equal(stalledSignal.aborted,true)
  finishLateFetch(new Response(new ReadableStream({cancel(){lateBodyCancelled=true}}),
    {headers:{'Content-Type':'application/json'}}))
  await new Promise(resolve=>originalTimer(resolve,10))
  assert.equal(lateBodyCancelled,true,'late response after ignored abort must cancel provider body')
  console.log('Actual iStar transport: fixed targets, bounded bodies/deadlines, no redirects, no POST retry and sanitized errors passed')
}finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer}
