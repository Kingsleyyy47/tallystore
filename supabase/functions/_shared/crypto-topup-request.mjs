export function canonicalCryptoAmount(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text)) return null
  const number = Number(text)
  if (!Number.isFinite(number) || number <= 0) return null
  const [whole, fraction = ''] = text.split('.')
  const significantFraction = fraction.replace(/0+$/, '')
  return significantFraction ? `${whole}.${significantFraction}` : whole
}

export function sameCryptoTopupRequest(existing, requested) {
  const storedAmount = canonicalCryptoAmount(existing.crypto_amount)
  const requestedAmount = canonicalCryptoAmount(requested.crypto_amount)
  return storedAmount !== null && storedAmount === requestedAmount
    && String(existing.crypto_type || '').toUpperCase() === String(requested.crypto_type || '').toUpperCase()
    && (!requested.network || String(existing.nowpayments_network || '') === String(requested.network))
    && existing.transaction_type === 'sell'
    && existing.payment_provider === 'nowpayments'
}
