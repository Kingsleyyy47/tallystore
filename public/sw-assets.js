// Public immutable build assets only. No HTML, API, wallet or credential data
// is cached by this handler. It supports a tab waiting to apply an update.
const tallyBuildReports = 'tallystore-client-builds-v1'
const tallyReportUrl = clientId => new URL(`/__tally_build_report__/${encodeURIComponent(clientId)}`, self.location.origin).href
let tallyCleanupQueue = Promise.resolve()

function queueTallyCacheCleanup() {
  tallyCleanupQueue = tallyCleanupQueue.catch(() => undefined).then(async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const reports = await caches.open(tallyBuildReports)
    const active = new Set(clients.map(client => tallyReportUrl(client.id)))
    for (const request of await reports.keys()) if (!active.has(request.url)) await reports.delete(request)
    const versions = []
    for (const client of clients) {
      const report = await reports.match(tallyReportUrl(client.id))
      // A sleeping/uninitialized tab has not confirmed its build yet. Preserve
      // assets until it reports or closes, rather than breaking a lazy import.
      if (!report) return
      const version = await report.text()
      if (!/^[A-Za-z0-9_-]{1,180}$/.test(version)) return
      versions.push(version)
    }
    const buildCaches = (await caches.keys()).filter(name =>
      (name.startsWith('tallystore-') || name.startsWith('workbox-')) && name.includes('-precache-'))
    const keep = new Set(buildCaches.slice(-5))
    for (const name of buildCaches) {
      if (versions.some(version => name.startsWith(`tallystore-${version}-precache-`))) keep.add(name)
    }
    for (const name of buildCaches) if (!keep.has(name)) await caches.delete(name)
  })
  return tallyCleanupQueue.catch(() => undefined)
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'TALLY_CLIENT_BUILD' || typeof event.data.buildVersion !== 'string' ||
      !/^[A-Za-z0-9_-]{1,180}$/.test(event.data.buildVersion) || !event.source?.id) return
  event.waitUntil((async () => {
    const client = await self.clients.get(event.source.id)
    if (!client || new URL(client.url).origin !== self.location.origin) return
    const reports = await caches.open(tallyBuildReports)
    await reports.put(tallyReportUrl(client.id), new Response(event.data.buildVersion, { headers: { 'Content-Type': 'text/plain' } }))
    await queueTallyCacheCleanup()
  })())
})

self.addEventListener('activate', event => event.waitUntil(queueTallyCacheCleanup()))
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
      !/^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.(?:js|css)$/.test(url.pathname)) return
  event.respondWith((async () => {
    const cached = await caches.match(event.request)
    const type = cached?.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
    const validType = url.pathname.endsWith('.css') ? type === 'text/css' :
      ['application/javascript', 'text/javascript', 'application/ecmascript', 'text/ecmascript'].includes(type)
    return cached?.status === 200 && validType ? cached : fetch(event.request)
  })())
})
