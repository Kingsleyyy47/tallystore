const names:Record<string,string>={getatext:'GetAText',daisysms_io:'DaisySMS .io',daisysms_com:'DaisySMS .com',herosms:'HeroSMS',textverify:'TextVerify',smsbus:'DaisySim / SMSBus',daisysim:'DaisySim direct'}
export type SmsAdminRoute={strategy:string;selected_provider:string|null;candidate_count:number;funded_count:number}
export default function SmsRoutingSummary({price,markup,routing}:{price:number;markup:number;routing?:SmsAdminRoute}){
  return <div className="space-y-1 text-sm"><p className="font-bold">₦{Number(price).toLocaleString('en-NG')}</p><p className="text-xs text-muted-foreground">Fixed markup ₦{Number(markup).toLocaleString('en-NG')}</p><p className="text-xs text-muted-foreground">Auto: {routing?.selected_provider?names[routing.selected_provider]||routing.selected_provider:'No funded supplier with stock'}</p>{routing&&<p className="text-[11px] text-muted-foreground">{routing.funded_count} funded route(s) from {routing.candidate_count} exact match(es)</p>}</div>
}
