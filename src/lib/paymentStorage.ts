type PaymentStorageKey = 'pending_topup' | 'processed_transactions'

export function getPaymentStorageItem(key: PaymentStorageKey): string | null {
  const current = sessionStorage.getItem(key)
  const legacy = localStorage.getItem(key)
  if (legacy !== null) {
    if (current === null) sessionStorage.setItem(key, legacy)
    localStorage.removeItem(key)
  }
  return current ?? legacy
}

export function setPaymentStorageItem(key: PaymentStorageKey, value: string) {
  sessionStorage.setItem(key, value)
  localStorage.removeItem(key)
}

export function removePaymentStorageItem(key: PaymentStorageKey) {
  sessionStorage.removeItem(key)
  localStorage.removeItem(key)
}

export function clearPaymentStorage() {
  removePaymentStorageItem('pending_topup')
  removePaymentStorageItem('processed_transactions')
}
