import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {smmPanelRequest} from '../supabase/functions/_shared/smm-panel-transport.ts'

const origin='https://example.invalid/api'
const params={action:'add',service:123,quantity:1000,link:'https://example.invalid/post'}
let calls=0
const accepted=await smmPanelRequest(origin,'synthetic-test-key',params,async(url,init)=>{
  calls++
  assert.equal(url,origin)
  assert.equal(init.redirect,'error')
  assert.equal(init.method,'POST')
  assert.equal(init.signal.aborted,false)
  const body=new URLSearchParams(init.body)
  assert.equal(body.get('key'),'synthetic-test-key')
  assert.equal(body.get('action'),'add')
  assert.equal(body.get('service'),'123')
  assert.equal(body.get('quantity'),'1000')
  return new Response(JSON.stringify({order:23501}),{status:200,headers:{'content-type':'application/json'}})
})
assert.equal(accepted.order,23501)
assert.equal(calls,1)

let failedCalls=0
await assert.rejects(()=>smmPanelRequest(origin,'test',params,async()=>{
  failedCalls++
  return new Response('provider details withheld',{status:500})
}),/SMM_PANEL_HTTP_ERROR/)
assert.equal(failedCalls,1)

let canceled=false
const oversized=new ReadableStream({
  pull(controller){controller.enqueue(new Uint8Array(1_048_577))},
  cancel(){canceled=true},
})
await assert.rejects(()=>smmPanelRequest(origin,'test',params,async()=>new Response(oversized,{status:200})),/SMM_PANEL_RESPONSE_TOO_LARGE/)
assert.equal(canceled,true)

let hungAborted=false
const keepAlive=setTimeout(()=>{},100)
await assert.rejects(()=>smmPanelRequest(origin,'test',params,async(_url,init)=>{
  const stream=new ReadableStream({
    start(controller){init.signal.addEventListener('abort',()=>{hungAborted=true;controller.error(new Error('deadline elapsed'))},{once:true})},
  })
  return new Response(stream,{status:200})
},15),/deadline elapsed/)
clearTimeout(keepAlive)
assert.equal(hungAborted,true)

// Exercise Node's real fetch + response-body stream, not only a mock that
// observes the signal. The server sends headers and a partial JSON body,
// then keeps the socket open until the client's deadline closes it.
let liveCalls=0,bodySocketClosed=false
const server=createServer((request,response)=>{
  liveCalls++
  response.on('close',()=>{bodySocketClosed=true})
  response.writeHead(200,{'content-type':'application/json'})
  response.write('{"order":')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
try{
  const address=server.address()
  assert.ok(address && typeof address==='object')
  await assert.rejects(()=>smmPanelRequest(`http://127.0.0.1:${address.port}/`,'test',params,fetch,80),
    error=>error?.name==='TimeoutError' || error?.name==='AbortError')
  for(let i=0;i<30 && !bodySocketClosed;i++) await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(bodySocketClosed,true)
  assert.equal(liveCalls,1)
}finally{
  server.closeAllConnections()
  await new Promise(resolve=>server.close(resolve))
}

await assert.rejects(()=>smmPanelRequest(origin,'test',params,async()=>new Response('not json',{status:200})),/SMM_PANEL_RESPONSE_INVALID/)
await assert.rejects(()=>smmPanelRequest(origin,'test',params,async()=>new Response(JSON.stringify({error:'private provider text'}),{status:200})),/SMM_PANEL_REJECTED/)
console.log(JSON.stringify({actualModule:true,acceptedOnce:true,noHttpRetry:true,oversizeCanceled:true,hungBodyDeadline:true,realFetchBodyCanceled:true,invalidJsonDenied:true,providerErrorRedacted:true,paidProviderCalls:0}))
