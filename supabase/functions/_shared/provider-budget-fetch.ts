// Edge-local transport admission: no database round-trips per upstream call.
// Purchase authorization and one-use dispatch claims remain in the wallet DB.
const active = new Map<string, number>()
let total = 0
export async function providerFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('PROVIDER_UNAVAILABLE')
  if (total >= 32 || (active.get(url.hostname) || 0) >= 8) throw new Error('PROVIDER_BUSY')
  total++; active.set(url.hostname, (active.get(url.hostname) || 0) + 1)
  const controller = new AbortController()
  const abort = () => controller.abort()
  const signal = init.signal || (input instanceof Request ? input.signal : undefined)
  signal?.addEventListener('abort', abort, {once:true})
  if (signal?.aborted) controller.abort()
  let released = false
  const release = () => {
    if (released) return
    released=true;clearTimeout(timer);signal?.removeEventListener('abort',abort)
    total--;active.set(url.hostname,Math.max(0,(active.get(url.hostname)||1)-1))
  }
  const timer=setTimeout(()=>{controller.abort();release()},25_000)
  try {
    const response=await fetch(input,{...init,signal:controller.signal,redirect:'error',credentials:'omit'})
    if(!response.body){release();return response}
    const reader=response.body.getReader()
    return new Response(new ReadableStream({
      async pull(stream){try{const part=await reader.read();if(part.done){release();reader.releaseLock();stream.close()}else stream.enqueue(part.value)}catch{release();stream.error(new Error('PROVIDER_UNAVAILABLE'))}},
      cancel(){controller.abort();void reader.cancel().catch(()=>{});release()},
    }),{status:response.status,statusText:response.statusText,headers:response.headers})
  }catch{release();throw new Error('PROVIDER_UNAVAILABLE')}
}
