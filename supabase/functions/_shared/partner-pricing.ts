// Catalogue and checkout share exact NGN rounding, including partner markup.
export function partnerMarkup(partner: { markup_percent?: unknown }, amount: number, quantity = 1): number {
  const pct = Number(partner.markup_percent ?? 0)
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000
    || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(pct) || pct < 0
    || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7
    || Math.abs(pct * 100 - Math.round(pct * 100)) > 1e-7
    || !Number.isSafeInteger(Math.round(amount * 100))
    || !Number.isSafeInteger(Math.round(pct * 100))) {
    throw new Error('PRICE_UNAVAILABLE')
  }
  const minor = BigInt(Math.round(amount * 100))
  const basisPoints = BigInt(Math.round(pct * 100))
  const wholeNgn = (minor * BigInt(quantity) * (10000n + basisPoints) + 999999n) / 1000000n
  if (wholeNgn > 1000000000n) throw new Error('PRICE_UNAVAILABLE')
  return Number(wholeNgn)
}
