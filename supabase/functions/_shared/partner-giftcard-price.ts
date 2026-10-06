// Exact retail unit pricing from the entire merchant invoice. Keep rational
// arithmetic through quantity division and round each retail unit upward to ₦10.
function decimal(value: number): { n: bigint; d: bigint } {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw Error('PRICE_UNAVAILABLE')
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value))
  if (!match) throw Error('PRICE_UNAVAILABLE')
  const fraction = match[2] || '', exponent = Number(match[3] || 0) - fraction.length
  const n = BigInt(match[1] + fraction)
  return exponent >= 0 ? { n: n * 10n ** BigInt(exponent), d: 1n }
    : { n, d: 10n ** BigInt(-exponent) }
}
export function giftCardInvoiceRetailTotal(providerPrice: number, rate: number, quantity: number,
  rule: { mode: unknown; value: unknown }): number {
  if (providerPrice <= 0 || rate <= 0 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20
    || !rule || (rule.mode !== 'amount' && rule.mode !== 'percent') || typeof rule.value !== 'number'
    || !Number.isFinite(rule.value) || rule.value < 0
    || rule.value > (rule.mode === 'percent' ? 1000 : 1_000_000_000)) throw Error('PRICE_UNAVAILABLE')
  const price = decimal(providerPrice), conversion = decimal(rate), markup = decimal(rule.value)
  let n = price.n * conversion.n, d = price.d * conversion.d * BigInt(quantity)
  if (rule.mode === 'amount') { n = n * markup.d + markup.n * d; d *= markup.d }
  else { n *= 100n * markup.d + markup.n; d *= 100n * markup.d }
  const unit = (n + d * 10n - 1n) / (d * 10n) * 10n
  const total = unit * BigInt(quantity)
  if (total <= 0n || total > 1_000_000_000n) throw Error('PRICE_UNAVAILABLE')
  return Number(total)
}
