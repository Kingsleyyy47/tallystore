import {rankedSmsOffers,smsRoutingState} from '../supabase/functions/_shared/sms-provider-policy.ts';
import {smsBuy,smsCatalogue,smsStatus,smsProvidersConfigured} from '../supabase/functions/_shared/sms-provider-router.ts';
import {providerBalances,parseAccountBalances} from '../supabase/functions/_shared/provider-balances.ts';
import {invalidateProviderRead} from '../supabase/functions/_shared/provider-read-cache.ts';
const assert=(value:unknown,message='Assertion failed')=>{if(!value)throw new Error(message)};
const equal=(a:unknown,b:unknown)=>assert(JSON.stringify(a)===JSON.stringify(b),`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const rejects=async(task:()=>Promise<unknown>)=>{let failed=false;try{await task()}catch{failed=true}assert(failed)};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const health=(provider:string,product_key:string,delivered:number,failed:number,mean_delivery_ms=30000)=>({provider,product_key,accepted:delivered+failed,delivered,failed,mean_delivery_ms,no_stock:0,declined:0,unknown:0});
Deno.test('SMS routing prioritizes actual reliability and speed for each product and falls back to price while learning',()=>{
  const offers=[{provider:'getatext',price:0.4},{provider:'daisysms_io',price:0.6}];
  const state={controls:{},metrics:[health('getatext','wa',20,0),health('daisysms_io','wa',5,10),health('getatext','go',2,10),health('daisysms_io','go',25,0)]};
  equal(rankedSmsOffers(offers,state,'wa')[0].provider,'getatext');equal(rankedSmsOffers(offers,state,'go')[0].provider,'daisysms_io');
  equal(rankedSmsOffers(offers,{controls:{},metrics:[]},'wa')[0].provider,'getatext');
  equal(rankedSmsOffers(offers,{controls:{getatext:false},metrics:state.metrics},'wa')[0].provider,'daisysms_io');
  const circuit={...health('getatext','wa',25,0),circuit_until:new Date(Date.now()+60000).toISOString()};
  equal(rankedSmsOffers(offers,{controls:{},metrics:[circuit]},'wa')[0].provider,'daisysms_io');
  const speed={controls:{},metrics:[health('getatext','wa',25,0,240000),health('daisysms_io','wa',25,0,15000)]};
  equal(rankedSmsOffers(offers,speed,'wa')[0].provider,'daisysms_io');
});
const keyNames=['GETATEXT_API_KEY','DAISYSMS_API_KEY','DAISYSMS_IO_API_KEY','DAISYSMS_COM_API_KEY','DAISYSMS_BASE_URL','DAISYSIM_API_KEY','HEROSMS_API_KEY','SMSACTIVATE_API_KEY','TEXTVERIFY_API_KEY','SMSBUS_API_KEY','LORDOFPANELS_API_KEY','SMM_PANEL_API_KEY','BULKFOLLOWS_API_KEY','BITREFILL_API_KEY','ISTAR_API_KEY','FRAGMENTAPI_API_KEY','KORAPAY_SECRET_KEY','NOWPAYMENTS_API_KEY','POCKETFI_SECRET_KEY','POCKETFI_PUBLIC_KEY','ERCASPAY_SECRET_KEY','SAGECLOUD_SECRET_KEY','MUABANVIA_API_KEY','SHOPCLONE_API_KEY','SHOPVIACLONE_API_KEY','ANTHROPIC_API_KEY'];
Deno.test('TextVerify drops after poor delivery and automatically recovers its ranking with healthy results',()=>{
  const offers=[{provider:'textverify',price:0.4},{provider:'daisysms_io',price:0.6},{provider:'getatext',price:0.7}];
  const degraded={controls:{},metrics:[health('textverify','wa',2,30,240000)]};
  equal(rankedSmsOffers(offers,degraded,'wa').at(-1)?.provider,'textverify');
  const recovered={controls:{},metrics:[health('textverify','wa',300,0,1000)]};
  equal(rankedSmsOffers(offers,recovered,'wa')[0].provider,'textverify');
  equal(rankedSmsOffers(offers,{controls:{textverify:false},metrics:recovered.metrics},'wa').some(offer=>offer.provider==='textverify'),false);
});
Deno.test('international provider selection is country-specific, enforces fresh choices, and does not alter US automatic ranking',()=>{
  const offers=[{provider:'herosms',price:0.4},{provider:'smsbus',price:0.6}];
  const state={controls:{},international_provider:'smsbus',metrics:[]};
  equal(rankedSmsOffers(offers,state,'c-CA~wa').map(offer=>offer.provider),['smsbus']);
  equal(rankedSmsOffers(offers,state,'wa').map(offer=>offer.provider),['herosms','smsbus']);
  equal(rankedSmsOffers(offers,{...state,international_provider:'herosms'},'c-CA~wa').map(offer=>offer.provider),['herosms']);
  equal(rankedSmsOffers(offers,{...state,controls:{smsbus:false}},'c-CA~wa'),[]);
});
async function mock(keys:Record<string,string>,fetcher:typeof fetch,task:()=>Promise<void>){
  const saved=keyNames.map(key=>Deno.env.get(key)),original=globalThis.fetch;invalidateProviderRead('');
  keyNames.forEach(key=>Deno.env.delete(key));Object.entries(keys).forEach(([key,value])=>Deno.env.set(key,value));globalThis.fetch=fetcher;
  try{await task()}finally{globalThis.fetch=original;keyNames.forEach((key,i)=>saved[i]===undefined?Deno.env.delete(key):Deno.env.set(key,saved[i]!));invalidateProviderRead('')}
}
Deno.test('country/service cards group matching offers without combining variants, countries or supplier stock pools',async()=>{
  let selected='smsbus',paid=0;
  const admin={rpc:async(name:string)=>({data:name==='get_sms_provider_routing_state'?{controls:{},international_provider:selected,metrics:[]}:true,error:null})};
  await mock({GETATEXT_API_KEY:'synthetic-getatext',SMSBUS_API_KEY:'synthetic-smsbus'},async(input)=>{
    const url=new URL(String(input));
    if(url.hostname==='getatext.com')return json({prices:[{api_name:'whatsapp',service_name:'WhatsApp',price:0.5,stock:3,multiple_sms:true},{api_name:'igthreads',service_name:'Instagram / Threads',price:0.7,stock:7,multiple_sms:true},{api_name:'instagram',service_name:'Instagram',price:0.6,stock:5,multiple_sms:false}]});
    if(url.pathname.endsWith('/list/countries'))return json({code:200,data:[{id:1,code:'us',title:'United States'},{id:7,code:'ca',title:'Canada'}]});
    if(url.pathname.endsWith('/list/projects'))return json({code:200,data:[{id:55,title:'WhatsApp'}]});
    if(url.pathname.endsWith('/list/prices'))return json({code:200,data:[{project_id:55,cost:0.3,total_count:2}]});
    paid++;throw new Error('No paid request expected');
  },async()=>{
    const us=await smsCatalogue(true,admin,'US'),wa=us.products.find(product=>product.code==='wa')!;
    equal(wa.offers.length,2);equal(wa.count,2);equal(wa.priceUsd,0.3);
    assert(us.products.some(product=>product.name==='Instagram / Threads'));assert(us.products.some(product=>product.name==='Instagram'));
    const canada=await smsCatalogue(true,admin,'CA');equal(canada.products.length,1);equal(canada.products[0].code,'c-CA~wa');equal(canada.products[0].offers.map(offer=>offer.provider),['smsbus']);
    selected='herosms';await rejects(()=>smsBuy('c-CA~wa',1,admin));equal(paid,0);
  });
});
Deno.test('disabled SMS provider is excluded at purchase even with a warm catalogue; accepted status remains pinned',async()=>{
  let enabled=true;const paid:string[]=[],events:any[]=[];
  const admin={rpc:async(name:string,args:any)=>{
    if(name==='get_sms_provider_routing_state')return {data:{controls:{daisysms_io:enabled},metrics:[]},error:null};
    equal(name,'record_sms_provider_delivery');events.push(args);return {data:true,error:null};
  }};
  await mock({GETATEXT_API_KEY:'synthetic-getatext',DAISYSMS_IO_API_KEY:'synthetic-daisy'},async(input,init={})=>{
    const url=new URL(String(input));
    if(url.hostname==='daisysms.io'){
      const action=url.searchParams.get('action');
      if(action==='getPricesVerification')return json({wa:{187:{price:0.4,count:10}}});
      if(action==='getStatus')return new Response('STATUS_OK:123456');
      paid.push('daisysms_io');return new Response('ACCESS_NUMBER:1:15550000001',{headers:{'X-Price':'0.4'}});
    }
    if(url.pathname.endsWith('prices-info'))return json({status:'success',errors:null,prices:[{api_name:'whatsapp',service_name:'WhatsApp',price:0.6,stock:10,multiple_sms:true}]});
    paid.push('getatext');return json({id:123,number:'15550000001',price:'0.6',status:'success'},201);
  },async()=>{
    equal((await smsCatalogue(true,admin)).products.find(row=>row.code==='wa')?.offers.length,2);
    enabled=false;const receipt=await smsBuy('wa',1,admin);equal(paid,['getatext']);assert(receipt.activationId.includes('getatext'));
    equal(await smsStatus('p1:daisysms_io:1',12000,admin),{status:'ok',code:'123456'});
    assert(events.some(event=>event.p_kind==='accepted'));assert(events.some(event=>event.p_kind==='delivered'&&event.p_provider==='daisysms_io'));
  });
});
Deno.test('a policy read failure stops allocation and uncertain supplier replies never send a second purchase',async()=>{
  let purchases=0;
  await mock({GETATEXT_API_KEY:'synthetic-getatext'},async(input)=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('prices-info'))return json({prices:[{api_name:'whatsapp',service_name:'WhatsApp',price:0.5,stock:1}]});
    purchases++;return new Response('MALFORMED_PRIVATE_REPLY');
  },async()=>{
    await rejects(()=>smsBuy('wa',1,{rpc:async()=>({data:null,error:{code:'OFFLINE'}})}));equal(purchases,0);
    const events:any[]=[];const admin={rpc:async(name:string,args:any)=>{if(name==='get_sms_provider_routing_state')return {data:{controls:{},metrics:[]},error:null};events.push(args);return {data:true,error:null}}};
    await rejects(()=>smsBuy('wa',1,admin));equal(purchases,1);equal(events.at(-1).p_kind,'unknown');
  });
});
Deno.test('provider balances preserve zero and native currencies, cache reads, and never expose API credentials',async()=>{
  let calls=0;const secret='synthetic-account-key-never-return';
  await mock({GETATEXT_API_KEY:secret},async(input,init={})=>{
    calls++;assert(String(input).endsWith('/balance'));equal((init.headers as Record<string,string>).Auth,secret);
    return json({status:'success',balance:'0.00',api_key:secret});
  },async()=>{
    const first=await providerBalances(),second=await providerBalances();equal(calls,1);
    const account=first.find(row=>row.id==='getatext')!;equal(account.status,'ready');equal(account.balances,[{currency:'USD',available:'0.00'}]);
    assert(!JSON.stringify([first,second]).includes(secret));
  });
  equal(parseAccountBalances({data:{USD:{available_balance:'12.3456',pending_balance:'1'},TON:{amount:'0.123456789'}}}),[{currency:'USD',available:'12.3456',pending:'1'},{currency:'TON',available:'0.123456789'}]);
  equal(parseAccountBalances({btc:{amount:'0.5',pendingAmount:'0.1'}}),[{currency:'BTC',available:'0.5',pending:'0.1'}]);
});
Deno.test('provider access errors show unavailable balances instead of invented zero balances',async()=>{
  await mock({GETATEXT_API_KEY:'synthetic-getatext'},async()=>json({error:'denied'},403),async()=>{
    const account=(await providerBalances()).find(row=>row.id==='getatext')!;equal(account.status,'blocked');equal(account.balances,[]);
  });
});
Deno.test('store DaisySim account is one SMSBus connection without a duplicate account or cross-domain key reuse',async()=>{
  const requests:string[]=[];
  await mock({SMSBUS_API_KEY:'synthetic-store-daisysim-account'},async(input)=>{
    const url=new URL(String(input));requests.push(url.hostname);
    equal(url.hostname,'sms-bus.com');equal(url.pathname,'/api/control/get/balance');
    return json({code:200,data:{balance:'12.50',frozen:'0'}});
  },async()=>{
    equal(smsProvidersConfigured(),['smsbus']);
    const accounts=await providerBalances();
    assert(!accounts.some(account=>account.id==='daisysim'));
    const account=accounts.find(account=>account.id==='smsbus')!;
    equal(account.name,'DaisySim / SMSBus');equal(account.status,'ready');equal(requests,['sms-bus.com']);
  });
});
