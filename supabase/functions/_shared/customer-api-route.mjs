export function customerApiRoute(pathname, method) {
  const input = pathname.startsWith('/') ? pathname : `/${pathname}`
  const path = input.replace(/^\/(?:functions\/v1\/)?customer-api(?=\/|$)/, '') || '/'
  if (path === '/v1/keys' || path.startsWith('/v1/keys/') || path === '/v1/admin/access') {
    return { kind: 'manage', path }
  }
  if (path === '/v1/purchases' && method === 'POST') return { kind: 'purchase', path }
  if (method === 'POST' && ['/v1/airtime/check-phone', '/v1/airtime/quote', '/v1/airtime/status'].includes(path)) {
    return { kind: 'airtime', path }
  }
  if (method === 'POST' && ['/v1/giftcards/details', '/v1/giftcards/quote', '/v1/giftcards/status'].includes(path)) {
    return { kind: 'giftcards', path }
  }
  if (method === 'POST' && ['/v1/telegram/recipient', '/v1/telegram/quote', '/v1/telegram/status'].includes(path)) {
    return { kind: 'telegram', path }
  }
  if (method === 'GET') return { kind: 'read', path }
  return { kind: 'not_found', path }
}
