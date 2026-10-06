import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
const source=readFileSync(new URL('../api/webhook-pocketfi.ts',import.meta.url),'utf8');
const bundled=await build({stdin:{contents:source,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const originalFetch=globalThis.fetch,originalOrigin=process.env.VITE_SUPABASE_URL;
const payload='{ "transaction": { "reference": "TEST_ONLY" } }\n';
const calls=[];
globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response('{"success":true}',{status:200,headers:{'Content-Type':'application/json'}});};
const response=()=>({statusCode:200,headers:{},status(v){this.statusCode=v;return this;},setHeader(k,v){this.headers[k]=v;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}});
try{
 for(const ref of ['dssvvswvqnxanyzfhixf','ktmlojvchkmzcdbjdyjx']){
  process.env.VITE_SUPABASE_URL=`https://${ref}.supabase.co`;
  const res=response();await handler({method:'POST',url:'/api/webhook-pocketfi',body:Buffer.from(payload),headers:{'pocketfi-signature':'TEST_SIGNATURE','content-type':'application/json'}},res);
  assert.equal(res.statusCode,200);const call=calls.at(-1);
  assert.equal(call.url,`https://${ref}.supabase.co/functions/v1/webhook-pocketfi`);
  assert.equal(call.options.body,payload);assert.equal(call.options.headers['pocketfi-signature'],'TEST_SIGNATURE');assert.equal(call.options.redirect,'error');
 }
 for(const origin of ['', 'https://example.invalid','https://ktmlojvchkmzcdbjdyjx.supabase.co@attacker.invalid','https://ktmlojvchkmzcdbjdyjx.supabase.co/path']){
  process.env.VITE_SUPABASE_URL=origin;const before=calls.length,res=response();await handler({method:'POST',url:'/api/webhook-pocketfi',headers:{},body:payload},res);
  assert.equal(res.statusCode,503);assert.equal(calls.length,before);
 }
 process.env.VITE_SUPABASE_URL='https://ktmlojvchkmzcdbjdyjx.supabase.co';
 const before=calls.length,res=response();await handler({method:'POST',url:'/api/webhook-pocketfi',headers:{},body:payload},res);assert.equal(res.statusCode,401);assert.equal(calls.length,before);
 console.log('PASS: project routing, exact signed body, fixed origins and missing-verification rejection; no live calls.');
}finally{globalThis.fetch=originalFetch;if(originalOrigin===undefined)delete process.env.VITE_SUPABASE_URL;else process.env.VITE_SUPABASE_URL=originalOrigin;}
