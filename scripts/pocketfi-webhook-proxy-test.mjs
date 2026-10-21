import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync('api/webhook-pocketfi.ts','utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const {createPocketfiProxy}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const raw='{ "amount": 0, "id": 9007199254740993, "note": "✓" }\n'
const request=(body=raw,headers={},url='https://tallystore.org/api/webhook-pocketfi')=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json','x-pocketfi-signature':'provider-signature',...headers},body})
let checked=0
async function test(name,fn){await fn();checked++;console.log('PASS '+name)}
await test('fixed Target and exact signed bytes including whitespace and large numeric text',async()=>{let calls=0;const fn=createPocketfiProxy(async(url,init)=>{calls++;assert.equal(url,'https://ktmlojvchkmzcdbjdyjx.supabase.co/functions/v1/webhook-pocketfi');assert.equal(Buffer.from(init.body).toString(),raw);assert.equal(init.headers.get('x-pocketfi-signature'),'provider-signature');assert.equal(init.headers.has('x-api-key'),false);assert.equal(init.redirect,'error');return Response.json({success:true})});const r=await fn(request(raw,{'x-api-key':'must-not-cross'}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{success:true});assert.equal(calls,1)})
await test('missing verification header never forwards',async()=>{const fn=createPocketfiProxy(()=>{throw Error('must not call')});assert.equal((await fn(new Request('https://tallystore.org/api/webhook-pocketfi',{method:'POST',body:'{}'}))).status,401)})
await test('query secrets rejected before forwarding',async()=>{const fn=createPocketfiProxy(()=>{throw Error('must not call')});assert.equal((await fn(request('{}',{},'https://tallystore.org/api/webhook-pocketfi?token=private'))).status,400)})
await test('non POST rejected',async()=>{const fn=createPocketfiProxy(()=>{throw Error('must not call')});assert.equal((await fn(new Request('https://tallystore.org/api/webhook-pocketfi'))).status,405)})
await test('oversized signed body rejected',async()=>{const fn=createPocketfiProxy(()=>{throw Error('must not call')});assert.equal((await fn(request('x'.repeat(65537)))).status,413)})
await test('empty body rejected',async()=>{const fn=createPocketfiProxy(()=>{throw Error('must not call')});assert.equal((await fn(request(''))).status,400)})
await test('verification failure preserves status and hides upstream internals',async()=>{let calls=0;const fn=createPocketfiProxy(async()=>{calls++;return Response.json({error:'private upstream detail'},{status:401})});const r=await fn(request());assert.equal(r.status,401);assert.ok(!(await r.text()).includes('private'));assert.equal(calls,1)})
await test('oversized upstream acknowledgement cannot become success',async()=>{const fn=createPocketfiProxy(async()=>new Response('x'.repeat(32769)));assert.equal((await fn(request())).status,502)})
await test('timeout fails without retry',async()=>{let calls=0;const fn=createPocketfiProxy(async(_url,init)=>{calls++;return await new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))},20);assert.equal((await fn(request())).status,502);assert.equal(calls,1)})
console.log(JSON.stringify({checksPassed:checked,networkCalls:0,paidRequests:0}))
