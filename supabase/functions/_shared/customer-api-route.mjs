export function customerApiRoute(pathname, method) {
  const input = pathname.startsWith('/') ? pathname : `/${pathname}`
  const path = input.replace(/^\/(?:functions\/v1\/)?customer-api(?=\/|$)/, '') || '/'
  if (path === '/v1/keys' || path.startsWith('/v1/keys/') || path === '/v1/admin/access') {
    return { kind: 'manage', path }
  }
  if (path === '/v1/purchases' && method === 'POST') return { kind: 'purchase', path }
  if (method === 'GET') return { kind: 'read', path }
  return { kind: 'not_found', path }
}
