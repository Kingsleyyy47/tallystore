function finiteNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function projectRevenueOrder(order) {
  const details = order.account_details && typeof order.account_details === 'object'
    && !Array.isArray(order.account_details) ? order.account_details : {}
  return {
    id: order.id,
    user_id: order.user_id,
    product_group_id: order.product_group_id,
    amount: order.amount,
    status: order.status,
    created_at: order.created_at,
    commerce_source: 'products',
    account_details: {
      quantity: finiteNumber(details.quantity),
      expected_amount_ngn: finiteNumber(details.expected_amount_ngn),
      charged_amount_ngn: finiteNumber(details.charged_amount_ngn),
      original_total: finiteNumber(details.original_total),
    },
  }
}
