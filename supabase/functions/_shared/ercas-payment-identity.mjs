function identity(source, keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (typeof value !== 'string' && typeof value !== 'number') continue
    const cleaned = String(value).trim()
    if (cleaned) return cleaned
  }
  return ''
}

export function matchesErcasCheckout(providerPayment, pendingPayment) {
  const checkoutReference = identity(providerPayment, [
    'ercs_reference', 'ercsReference', 'transactionReference', 'transaction_reference',
  ])
  const merchantReference = identity(providerPayment, [
    'tx_reference', 'txReference', 'paymentReference', 'payment_reference',
  ])
  const expectedCheckout = identity(pendingPayment, ['transaction_reference'])
  const expectedMerchant = identity(pendingPayment, ['ercas_reference'])

  return Boolean(
    expectedCheckout &&
    checkoutReference === expectedCheckout &&
    (!expectedMerchant || merchantReference === expectedMerchant)
  )
}
