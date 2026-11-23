import {useCallback,useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle,CardDescription} from '@/components/ui/card';
import {Switch} from '@/components/ui/switch';
import {Badge} from '@/components/ui/badge';
import {Loader2,RefreshCw} from 'lucide-react';
type Account={id:string;name:string;kind:string;configured:boolean;status:string;balances:Array<{currency:string;available:string;pending?:string;label?:string}>;checked_at:string;message?:string};
type SmsControl={id:string;name:string;configured:boolean;enabled:boolean;delivered:number;failed:number;success_rate:number|null;mean_delivery_ms:number|null};
type Snapshot={accounts:Account[];sms:SmsControl[];is_admin:boolean;last_sync:{finished_at:string|null;started_at:string;status:string}|null;auto_sync_schedule:string;routing:string};
function money(value:string,currency:string){
  const [whole,fraction='']=value.split('.');
  const sign=value.startsWith('-')?'-':'';
  try{return `${sign}${BigInt(whole.replace('-','')).toLocaleString()}${fraction?'.'+fraction:''} ${currency}`}catch{return `${value} ${currency}`}
}
export default function ProviderAccounts(){
  const [data,setData]=useState<Snapshot|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[showMissing,setShowMissing]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{const {data,error}=await supabase.functions.invoke('provider-operations',{body:{action:'snapshot'}});if(error||!data?.success)throw new Error(data?.error||'Could not load provider accounts');setData(data)}
    catch(error){setError(error instanceof Error?error.message:'Could not load provider accounts')}
    finally{setLoading(false)}
  },[]);
  useEffect(()=>{void load()},[load]);
  async function toggle(provider:SmsControl,enabled:boolean){
    setBusy(provider.id);setError('');setNotice('');
    try{const {data,error}=await supabase.functions.invoke('provider-operations',{body:{action:'toggle_sms',provider:provider.id,enabled}});if(error||!data?.success)throw new Error(data?.error||'Provider change could not be confirmed');setData(current=>current?{...current,sms:current.sms.map(row=>row.id===provider.id?{...row,enabled}:row)}:current);setNotice(`${provider.name} ${enabled?'enabled':'disabled'} for new SMS purchases.`)}
    catch(error){setError(error instanceof Error?error.message:'Provider update failed')}finally{setBusy(null)}
  }
  async function sync(){
    setBusy('sync');setError('');setNotice('');
    try{const {data,error}=await supabase.functions.invoke('provider-operations',{body:{action:'sync_now'}});if(error||!data?.success)throw new Error(data?.error||'Catalogue sync could not be confirmed');setNotice(data.skipped?'A catalogue sync is already running.':`Catalogues synced${data.partial?' with some providers requiring attention':''}. New boosting imports remain disabled.`);await load()}
    catch(error){setError(error instanceof Error?error.message:'Sync failed')}finally{setBusy(null)}
  }
  return <Card className="mb-6">
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>Provider balances & SMS routing</CardTitle><CardDescription>Supplier account funds in their original currencies. Balance checks cache for one minute.</CardDescription></div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={loading||!!busy} onClick={()=>void load()}>{loading?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<RefreshCw className="mr-2 h-4 w-4"/>}Refresh balances</Button>{data?.is_admin&&<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void sync()}>{busy==='sync'?'Syncing…':'Sync catalogues'}</Button>}</div></div></CardHeader>
    <CardContent className="space-y-5">
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {!data&&loading&&<p className="text-sm text-muted-foreground">Checking provider accounts…</p>}
      {data&&<><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>Auto sync: {data.auto_sync_schedule}. Last run: {data.last_sync?`${data.last_sync.status} · ${new Date(data.last_sync.finished_at||data.last_sync.started_at).toLocaleString()}`:'Waiting for first run'}</span><Button size="sm" variant="ghost" onClick={()=>setShowMissing(value=>!value)}>{showMissing?'Hide unconfigured providers':'Show unconfigured providers'}</Button></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{data.accounts.filter(account=>showMissing||account.configured).map(account=><div key={account.id} className="rounded-lg border p-3"><div className="mb-2 flex items-center justify-between gap-2"><p className="font-semibold">{account.name}</p><Badge variant={account.status==='ready'?'secondary':'outline'}>{account.status==='ready'?'Connected':account.status==='missing'?'No key':account.status==='blocked'?'Access denied':account.status==='unsupported'?'Not exposed':'Unavailable'}</Badge></div>{account.balances.length?account.balances.map(balance=><div key={balance.currency+(balance.label||'')}>{balance.label&&<p className="text-xs text-muted-foreground">{balance.label}</p>}<p className="break-all font-mono text-base font-bold">{money(balance.available,balance.currency)}</p>{balance.pending&&Number(balance.pending)!==0&&<p className="text-xs text-muted-foreground">Pending / reserved: {money(balance.pending,balance.currency)}</p>}</div>):<p className="text-xs text-muted-foreground">{account.message||'Balance unavailable'}</p>}<p className="mt-2 text-[11px] text-muted-foreground">Checked {new Date(account.checked_at).toLocaleTimeString()}</p></div>)}</div>
      <div><h3 className="mb-1 text-sm font-semibold">SMS supplier switches</h3><p className="mb-3 text-xs text-muted-foreground">Staff can enable or disable suppliers for new purchases. Existing phone numbers, status checks and refunds keep their original supplier.</p><div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr><th className="p-3">Supplier</th><th className="p-3">New orders</th><th className="p-3">Confirmed delivery</th><th className="p-3">Average observed time</th></tr></thead><tbody>{data.sms.map(provider=><tr key={provider.id} className="border-t"><td className="p-3 font-medium">{provider.name}{!provider.configured&&<span className="ml-2 text-xs text-muted-foreground">Key missing</span>}</td><td className="p-3"><Switch aria-label={`Enable ${provider.name} for new SMS orders`} checked={provider.configured&&provider.enabled} disabled={!provider.configured||!!busy} onCheckedChange={enabled=>void toggle(provider,enabled)}/></td><td className="p-3">{provider.success_rate===null?'Collecting data':`${Math.round(provider.success_rate*100)}% · ${provider.delivered} delivered`}</td><td className="p-3">{provider.mean_delivery_ms===null?'—':`${Math.round(provider.mean_delivery_ms/1000)} sec`}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-muted-foreground">Each product is ranked separately by confirmed delivery reliability, speed and availability. Confirmed stock failures move to the next eligible supplier; uncertain paid requests wait for reconciliation.</p></div></>}
    </CardContent>
  </Card>;
}
