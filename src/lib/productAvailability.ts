import type { ProductGroup } from '@/lib/supabase'

export function canAutoFulfillProduct(productGroup: ProductGroup) {
  return Boolean(
      isCustomerVisibleProduct(productGroup) &&
      productGroup.is_sellable === true &&
      String(productGroup.availability_status || '').toUpperCase() === 'UNLIMITED',
  )
}

export function isCustomerVisibleProduct(productGroup: ProductGroup) {
  const active = productGroup.is_active === true
  const price = Number(productGroup.price)
  return active && Number.isFinite(price) && price > 0
}

export function isCustomerSellableProduct(productGroup: ProductGroup) {
  if (!isCustomerVisibleProduct(productGroup)) return false
  const availabilityStatus = String(productGroup.availability_status || '').toUpperCase()
  const statusBlocked = ['UNAVAILABLE', 'PAUSED'].includes(availabilityStatus)
  if (productGroup.is_sellable === false || statusBlocked) return false
  const stock = Number(productGroup.stock_count)
  return (Number.isFinite(stock) && stock > 0) || canAutoFulfillProduct(productGroup)
}
