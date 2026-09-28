export function ngnMinorUnits(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null

  const [whole, fraction = ''] = text.split('.')
  const normalizedWhole = whole.replace(/^0+/, '') || '0'
  if (normalizedWhole.length > 14) return null
  const minor = BigInt(normalizedWhole) * 100n + BigInt(fraction.padEnd(2, '0') || '0')
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(minor)
}
