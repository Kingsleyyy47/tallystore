import { ngnMinorUnits } from './ngn-amount.mjs'

export function sameBitrefillRequest(existing, requested) {
  const storedAmount = ngnMinorUnits(existing.amount_ngn)
  const expectedAmount = ngnMinorUnits(requested.expected_amount_ngn)
  if (storedAmount === null || expectedAmount === null || storedAmount !== expectedAmount) return false
  if (existing.product_id !== requested.product_id
      || existing.product_name !== requested.product_name
      || String(existing.package_id ?? '') !== String(requested.package_id ?? '')
      || Number(existing.quantity) !== requested.quantity
      || String(existing.recipient_phone ?? '') !== String(requested.recipient_phone ?? '')
      || existing.payment_source !== requested.payment_source) return false

  if (requested.package_id) return true
  const denominationMinor = ngnMinorUnits(requested.value)
  const storedOriginalMinor = ngnMinorUnits(existing.amount_original)
  return denominationMinor !== null && storedOriginalMinor !== null
    && storedOriginalMinor === denominationMinor * requested.quantity
}
