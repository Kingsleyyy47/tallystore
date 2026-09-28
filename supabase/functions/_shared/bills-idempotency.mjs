import { ngnMinorUnits } from './ngn-amount.mjs'

export function sameBillsRequest(existing, requested) {
  const existingAmount = ngnMinorUnits(existing.amount)
  const requestedAmount = ngnMinorUnits(requested.amount)
  return existingAmount !== null && requestedAmount !== null
    && existingAmount === requestedAmount
    && existing.transaction_type === requested.transaction_type
    && existing.service_provider === requested.service_provider
    && existing.beneficiary_phone === requested.beneficiary_phone
    && existing.payment_source === requested.payment_source
    && String(existing.service_code ?? '') === String(requested.service_code ?? '')
}
