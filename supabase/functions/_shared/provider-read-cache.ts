// Process-local read cache and single-flight sharing. No credentials are cached
// in keys, no financial POST is cached/retried, and no Supabase cache RPC is used.
const values = new Map<string,{until:number;value:unknown}>()
const pending = new Map<string,Promise<unknown>>()
export function invalidateProviderRead(prefix:string){for(const key of values.keys())if(key.startsWith(prefix))values.delete(key)}
export async function providerRead<T>(key:string,ttlMs:number,load:()=>Promise<T>):Promise<T>{
  const cached=values.get(key)
  if(cached&&cached.until>Date.now())return cached.value as T
  const flight=pending.get(key)
  if(flight)return flight as Promise<T>
  const promise=load().then(value=>{
    if(values.size>=1024)values.delete(values.keys().next().value!)
    values.set(key,{until:Date.now()+ttlMs,value});return value
  }).finally(()=>pending.delete(key))
  pending.set(key,promise)
  return promise
}
