import assert from 'node:assert/strict'
import {telegramProviderJson} from '../supabase/functions/_shared/telegram-provider-transport.ts'
const enc=new TextEncoder(),url='https://supplier.invalid/orders/star'
let calls=0
assert.deepEqual(await telegramProviderJson(url,{method:'POST',body:'{}'},{timeoutMs:100,fetcher:async(u,o)=>{
 calls++;assert.equal(u,url);assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');assert.equal(o.cache,'no-store');assert.ok(o.signal);return Response.json({ok:true})
}}),{ok:true});assert.equal(calls,1)
const reject=async(fetcher,timeoutMs=100)=>{
 const started=Date.now();await assert.rejects(telegramProviderJson(url,{method:'POST',body:'{}'},{timeoutMs,fetcher}),/^Error: Supplier request failed$/);assert.ok(Date.now()-started<1000)
}
for(const fetcher of [async()=>Response.json({secret:'raw-provider'}, {status:500}),async()=>new Response('invalid JSON'),
 async()=>new Response(new Uint8Array([255])),async()=>new Response('{}',{headers:{'Content-Length':'1048577'}}),
 async()=>new Response('{}',{headers:{'Content-Length':'bogus'}}),async()=>{throw Error('raw secret failure')}])await reject(fetcher)
let canceled=false
await reject(async()=>new Response(new ReadableStream({start(c){c.enqueue(enc.encode('{'))},cancel(){canceled=true}})),20)
assert.equal(canceled,true,'active hanging body reader cancelled at deadline')
let lateCanceled=false
await reject(async()=>{await new Promise(r=>setTimeout(r,60));return new Response(new ReadableStream({cancel(){lateCanceled=true}}))},20)
await new Promise(r=>setTimeout(r,80));assert.equal(lateCanceled,true,'late fetch ignoring abort must release body')
await reject(async()=>new Promise(()=>{}),20)
canceled=false
await reject(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1048577))},cancel(){canceled=true}})))
assert.equal(canceled,true,'oversize streamed body cancelled')
calls=0;await reject(async()=>{calls++;return Response.json({error:'no'},{status:500})});assert.equal(calls,1,'no automatic paid retry')
await assert.rejects(telegramProviderJson(url,{}, {timeoutMs:25001,fetcher:async()=>{throw Error('must not run')}}))
console.log('Telegram supplier transport: bounded headers/body deadline, ignored abort, active/late reader cancellation, 1 MiB cap, safe errors and exactly one paid request passed (offline).')
