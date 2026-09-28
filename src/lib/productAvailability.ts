import type { ProductGroup } from '@/lib/supabase'

export function canAutoFulfillProduct(productGroup: ProductGroup) {
  const liveFulfillmentEnabled = import.meta.env.VITE_LIVE_ACCOUNT_FULFILLMENT_ENABLED === 'true'
  return Boolean(
    liveFulfillmentEnabled &&
      productGroup.is_sellable !== false &&
      String(productGroup.availability_status || '').toUpperCase() === 'UNLIMITED',
  )
}

export function isCustomerSellableProduct(productGroup: ProductGroup) {
  const active = productGroup.is_active !== false
  const price = Number(productGroup.price)
  const validPrice = Number.isFinite(price) && price > 0
  const explicitSellable = productGroup.is_sellable
  const availabilityStatus = String(productGroup.availability_status || '').toUpperCase()
  const statusSellable = ['AVAILABLE', 'LOW_STOCK', 'PREORDER', 'BACKORDER'].includes(availabilityStatus) ||
    (availabilityStatus === 'UNLIMITED' && canAutoFulfillProduct(productGroup))
  const statusBlocked = ['UNAVAILABLE', 'PAUSED'].includes(availabilityStatus)
  const blocked = explicitSellable === false || statusBlocked
  const available = !blocked && (statusSellable || Number(productGroup.stock_count || 0) > 0 || canAutoFulfillProduct(productGroup))
  return active && validPrice && available
}
