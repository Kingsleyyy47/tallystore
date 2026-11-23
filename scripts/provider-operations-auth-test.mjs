import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync('supabase/functions/provider-operations/index.ts','utf8');
let fixture,handler;
const admin={auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'staff-user'}:null},error:fixture.signedIn?null:{message:'not signed in'}})},from(table){return {select(){return this},eq(){return this},order(){return this},limit(){return this},single:async()=>({data:fixture.profile,error:null}),maybeSingle:async()=>({data:null,error:null})}},rpc:async(name,args)=>{fixture.writes++;assert.equal(name,'set_sms_provider_enabled');assert.equal(args.p_actor,'staff-user');return {data:{success:true,provider:args.p_provider,enabled:args.p_enabled},error:null}}};
const globals={Request,Response,Headers,AbortSignal,JSON,Promise,Date,Object,String,Error,
 Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://fixture.supabase.invalid':key==='SUPABASE_SERVICE_ROLE_KEY'?'synthetic-service-secret':''},serve:fn=>handler=fn},
 createClient:()=>admin,fetch:async()=>new Response('',{status:401}),
 providerBalances:async()=>[{id:'getatext',name:'GetAText',configured:true,status:'ready',balances:[{currency:'USD',available:'1.50'}]}],
 smsRoutingState:async()=>({controls:{getatext:true},metrics:[]}),SMS_PROVIDER_IDS:['getatext'],smsProvidersConfigured:()=>['getatext'],invalidateSmsPolicy(){},
 syncProviderCatalogues:async()=>{fixture.syncs++;return {success:true}},
};
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[^\n]*\n/gm,'').replace(/^export \{\};?\s*$/gm,'');vm.runInNewContext(code,globals);
const request=async(body,authorization='Bearer user-token')=>{const response=await handler(new Request('https://fixture.supabase.invalid/functions/v1/provider-operations',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()}};
fixture={signedIn:false,profile:{is_admin:false,is_staff:false},writes:0,syncs:0};assert.equal((await request({action:'snapshot'},'')).status,401);
fixture.signedIn=true;assert.equal((await request({action:'snapshot',is_admin:true})).status,403);
fixture.profile={is_staff:true,account_suspended:true};assert.equal((await request({action:'snapshot'})).status,403);
fixture.profile={is_staff:true,account_suspended:false};const snapshot=await request({action:'snapshot'});assert.equal(snapshot.status,200);assert.equal(snapshot.body.accounts[0].balances[0].available,'1.50');assert.equal(JSON.stringify(snapshot).includes('synthetic-service-secret'),false);
assert.equal((await request({action:'sync_now'})).status,403);assert.equal(fixture.syncs,0);
assert.equal((await request({action:'toggle_sms',provider:'getatext',enabled:false,actor_id:'forged-user'})).status,200);assert.equal(fixture.writes,1);
assert.equal((await request({action:'toggle_sms',provider:'korapay',enabled:true})).status,400);assert.equal(fixture.writes,1);
assert.equal((await request({action:'toggle_sms',provider:'getatext',enabled:'true'})).status,400);
fixture.profile={is_admin:true,account_suspended:false};assert.equal((await request({action:'sync_now'})).status,200);assert.equal(fixture.syncs,1);
console.log('Provider operations actual handler: anonymous/customer/suspended denial, staff balances and SMS-only switches, server-bound actor, admin-only sync and no credential exposure passed.');
