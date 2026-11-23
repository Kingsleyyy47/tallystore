import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import {
  smsCatalogue,
  smsProvidersConfigured,
  syncDaisySimPage,
} from "../_shared/sms-provider-router.ts";
import {
  configuredSmmProviders,
  syncSmmProviders,
  smmProviderReadiness,
} from "../_shared/smm-provider-router.ts";
import { getNgnUsdRate } from "../_shared/exchange-rate.ts";
import { liveSmmCatalogue, refreshSmmService, publicSmmService } from '../_shared/smm-live-catalog.ts';
import { smmProviderCatalogue } from '../_shared/smm-provider-router.ts';
import { isVisibleProvider, SMSBUS_DISPLAY_NAME } from '../_shared/provider-display.ts';
const serve = Deno.serve;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const env = (key: string) => !!Deno.env.get(key);
serve(async (req) => {
  if (req.method === "OPTIONS") return json({});
  if (req.method !== "POST") return json({ success: false }, 405);
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } },
    );
    const body=await req.json()
    const authorization=req.headers.get('Authorization')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    let secretKeys:Record<string,string>={}
    try{secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')}catch{/* Legacy deployments use the service-role JWT. */}
    const suppliedApiKey=req.headers.get('apikey')||''
    let internal=(!!service&&authorization===`Bearer ${service}`)||Object.values(secretKeys).some(key=>!!key&&key===suppliedApiKey)
    // Older service JWTs remain valid across platform-managed key rotations.
    // Validate those with the database's service-only table privilege, solely
    // for the read-only smoke action. Browser roles have no table privileges.
    if(!internal&&body.action==='smoke_readonly'&&authorization.startsWith('Bearer ')){
      const token=authorization.slice(7)
      const probe=await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/supplier_product_routes?select=product_key&limit=0`,{headers:{apikey:token,Authorization:authorization},redirect:'error',signal:AbortSignal.timeout(5000)})
      internal=probe.status===200
      await probe.body?.cancel()
    }
    if(internal&&body.action==='smoke_readonly'){
      if(body.boost_catalogue===true){
        const catalogues=await Promise.all(configuredSmmProviders().map(async provider=>({provider,products:(await smmProviderCatalogue(provider)).length})));
        const services=await liveSmmCatalogue(admin);
        let fresh_quote=null;
        if(services.length){
          const stored=await admin.from('smm_services').select('*').eq('id',services[0].id).single();
          if(stored.error)throw new Error('SMM_CATALOG_UNAVAILABLE');
          fresh_quote=publicSmmService(await refreshSmmService(admin,stored.data,{fresh:true}));
        }
        return json({success:true,paid_calls:0,database_writes:0,cache_seconds:30,catalogues,visible_products:services.length,
          public_projection_safe:services.every(service=>!('external_id' in service)&&!('rate_usd' in service)&&!('_live_smm_routes' in service)),fresh_quote});
      }
      const [catalog,boosting]=await Promise.all([smsCatalogue(true,admin,'US'),smmProviderReadiness()])
      const database=await admin.from('supplier_product_routes').select('product_key').limit(0)
      const source_catalogues=smsProvidersConfigured().map(provider=>{const offers=catalog.products.flatMap(product=>product.offers.filter(offer=>offer.provider===provider));return {provider,products:offers.length,sample_names:offers.slice(0,8).map(offer=>offer.name)}})
      return json({success:true,paid_calls:0,database_writes:0,database_ready:!database.error,runtime_origin:Deno.env.get('SUPABASE_URL'),sms:{diagnostics:catalog.diagnostics,products:catalog.products.length,matched_products:catalog.products.filter(product=>product.offers.length>1).length,source_catalogues},boosting})
    }
    if(!internal||!['status'].includes(body.action)){
      const user=await admin.auth.getUser(authorization.replace(/^Bearer\s+/i,''))
      if(user.error||!user.data.user)return json({success:false,error:'Unauthorized'},401)
      const profile=await admin.from('profiles').select('is_admin,account_suspended').eq('id',user.data.user.id).single()
      if(profile.error||profile.data?.is_admin!==true||profile.data.account_suspended)return json({success:false,error:'Admin access required'},403)
    }
    if (body.action === "sync_daisysim") {
      return json({
        success: true,
        ...await syncDaisySimPage(
          admin,
          String(body.country || "US").toUpperCase(),
          Number(body.cursor || 0),
        ),
      });
    }
    if (body.action === "sync_smm") {
      return json({
        success: true,
        ...await syncSmmProviders(admin, (await getNgnUsdRate(admin)).rate),
      });
    }
    if (body.action === "sms_matches") {
      const catalog = await smsCatalogue(
        true,
        admin,
        String(body.country || "US").toUpperCase(),
      );
      return json({
        success: true,
        diagnostics: catalog.diagnostics,
        data: catalog.products.map((row) => ({
          name: row.name,
          country: body.country || "US",
          routes: row.offers.map((offer) => ({
            provider: offer.provider,
            product_id: offer.id,
            price_usd: offer.price,
            stock: offer.count,
          })),
        })),
      });
    }
    if (body.action === "smm_matches") {
      const result = await admin.from("supplier_product_routes").select(
        "product_key,match_key,routes,synced_at",
      ).eq("family", "smm").range(0, 499);
      if (result.error) throw new Error("CATALOG_UNAVAILABLE");
      return json({ success: true, data: (result.data || []).map((row: any) => {
        const identity = JSON.parse(row.match_key);
        return { name: `${identity[1]} · ${identity[7]} · ${identity[6]} · refill ${identity[8]} · cancel ${identity[9]}`,
          routes: row.routes.map((route: any) => ({ provider: route.provider, price_usd: route.rate })) };
      }) });
    }
    const sms = smsProvidersConfigured(), smm = configuredSmmProviders();
    const providers = [
      {
        id: "getatext",
        name: "GetAText",
        configured: sms.includes("getatext"),
        keys: ["GETATEXT_API_KEY"],
        docs: "https://getatext.com/api-docs",
      },
      {
        id: "daisysms_com",
        name: "DaisySMS .com",
        configured: sms.includes("daisysms_com"),
        keys: ["DAISYSMS_COM_API_KEY"],
        docs: "https://daisysms.com/docs/api",
      },
      {
        id: "daisysms_io",
        name: "DaisySMS .io",
        configured: sms.includes("daisysms_io"),
        keys: ["DAISYSMS_IO_API_KEY"],
        docs: "https://daisysms.io/docs/api",
      },
      {
        id: "daisysim",
        name: "DaisySim direct API (legacy)",
        configured: sms.includes("daisysim"),
        keys: ["DAISYSIM_API_KEY"],
        docs: "https://daisysim.com/doc",
        note:
          "Sync country pages, at most one page per minute. Purchases refresh the exact route.",
      },
      {
        id: "herosms",
        name: "HeroSMS",
        configured: sms.includes("herosms"),
        keys: ["HEROSMS_API_KEY", "HEROSMS_CURRENCY"],
        docs: "https://hero-sms.com/api",
        note: "Set HEROSMS_CURRENCY=USD only for a confirmed USD API account.",
      },
      {
        id: "textverify",
        name: "TextVerify",
        configured: sms.includes("textverify"),
        keys: ["TEXTVERIFY_API_KEY"],
        docs: "https://panel.textverify.io/api/documentation",
        note:
          "USA temporary tn101 service keys must be present in the live catalogue.",
      },
      {
        id: "smsbus",
        name: `${SMSBUS_DISPLAY_NAME} OTP and rentals`,
        configured: sms.includes("smsbus"),
        keys: ["SMSBUS_API_KEY", "SMS_RENTALS_ENABLED"],
        docs: "https://sms-bus.com/docs/",
        note: "Your DaisySim account uses this SMSBus connection. One account balance and SMS provider switch.",
      },
      {
        id: "pvacodes",
        name: "PVACodes",
        configured: env("PVACODES_API_KEY"),
        keys: ["PVACODES_API_KEY"],
        docs: "https://pvacodes.com/api",
        blocked: true,
        note:
          "Private endpoint reference required. No requests are sent to guessed endpoints.",
      },
      {
        id: "lordofpanels",
        name: "Lord of Panels",
        configured: smm.includes("lordofpanels"),
        keys: ["LORDOFPANELS_API_KEY"],
        docs: "https://thelordofthepanels.com/api",
      },
      {
        id: "bulkfollows",
        name: "BulkFollows",
        configured: smm.includes("bulkfollows"),
        keys: ["BULKFOLLOWS_API_KEY"],
        docs: "https://bulkfollows.com/api",
      },
      {
        id: "bitrefill",
        name: "Bitrefill Personal API",
        configured: env("BITREFILL_API_KEY"),
        keys: ["BITREFILL_API_KEY"],
        docs: "https://docs.bitrefill.com/reference/get_products",
        note:
          "Existing Personal API invoice flow. The separate Business API uses different credentials.",
      },
      {
        id: "pocketfi",
        name: "PocketFi",
        configured: env("POCKETFI_PUBLIC_KEY") || env("POCKETFI_API_TOKEN"),
        keys: [
          "POCKETFI_PUBLIC_KEY",
          "POCKETFI_BUSINESS_ID",
          "POCKETFI_SECRET_KEY",
        ],
        docs: "https://developer.pocketfi.ng/",
      },
      {
        id: "korapay",
        name: "Kora",
        configured: env("KORAPAY_SECRET_KEY"),
        keys: ["KORAPAY_SECRET_KEY", "KORAPAY_ENABLED"],
        docs: "https://developers.korapay.com/",
      },
      {
        id: "nowpayments",
        name: "NOWPayments",
        configured: env("NOWPAYMENTS_API_KEY"),
        keys: ["NOWPAYMENTS_API_KEY", "NOWPAYMENTS_IPN_SECRET"],
        docs: "https://documenter.getpostman.com/view/7907941/2s93JusNJt",
      },
      {
        id: "fragmentapi",
        name: "FragmentAPI",
        configured: env("FRAGMENTAPI_API_KEY") || env("ISTAR_API_KEY"),
        keys: ["FRAGMENTAPI_API_KEY"],
        docs: "https://www.fragmentapi.app/openapi.json",
      },
    ];
    return json({ success: true, data: providers.filter(provider=>isVisibleProvider(provider.id,provider.configured)) });
  } catch {
    return json({
      success: false,
      error:
        "Provider configuration could not be checked. Verify migrations and server secrets.",
    }, 503);
  }
});
