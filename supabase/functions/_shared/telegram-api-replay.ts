// Only the verified capability owner and validated original public request enter
// this fixed-field encoding. No supplier quote or current wallet state is used.
export function canonicalTelegramApiPurchase(userId: string, body: Record<string, unknown>) {
  return JSON.stringify({ version: 1, section: 'telegram', user_id: userId,
    product_type: body.product_type, username: body.username,
    quantity: body.product_type === 'stars' ? body.quantity : null,
    product_id: body.product_type === 'premium' ? body.product_id : null,
    expected_amount_ngn: body.expected_amount_ngn, idempotency_key: body.idempotency_key })
}

function minor(value: unknown): bigint | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) return null
  return (match[1] ? -1n : 1n) * (BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0')))
}

// Posted ledger evidence, not a current balance check or a success-shaped RPC.
export function telegramApiDebitProven(order: any, tx: any, userId: string, hash: string) {
  if (!order || !tx || !/^[a-f0-9]{64}$/.test(hash)) return false
  const amount = minor(order.price_ngn), before = minor(tx.balance_before), after = minor(tx.balance_after)
  const metadata = tx.metadata
  return amount !== null && amount > 0n && before !== null && after !== null && before >= amount && after >= 0n &&
    before - after === amount && minor(tx.amount) === -amount &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(tx.id)) && /^[a-f0-9]{64}$/i.test(String(tx.transaction_hash)) &&
    order.user_id === userId && tx.user_id === userId && order.customer_api_request_hash === hash &&
    tx.type === 'purchase' && tx.status === 'completed' && tx.currency === 'NGN' && tx.balance_type === 'wallet' &&
    tx.reference === order.reference && tx.idempotency_key === `telegram:purchase:${order.idempotency_key}` &&
    metadata?.source === 'telegram-stars' && metadata.source_order_table === 'telegram_orders' &&
    metadata.source_order_id === order.id && metadata.idempotency_key === order.idempotency_key &&
    metadata.source_debit_idempotency_key === tx.idempotency_key && metadata.order_type === order.order_type &&
    metadata.customer_api_request_hash === hash && metadata.trusted_principal_authorized === true &&
    minor(metadata.trusted_principal_debit_amount) === amount
}
