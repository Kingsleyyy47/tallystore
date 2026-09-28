export function isAuthorizedRevenueLoopRequest(req, serviceRoleKey) {
  if (!serviceRoleKey) return false
  return req.headers.get('authorization') === `Bearer ${serviceRoleKey}`
}
