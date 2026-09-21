import type { ProductGroup } from '@/lib/supabase'

export function canAutoFulfillProduct(productGroup: ProductGroup) {
  const liveFulfillmentEnabled = import.meta.env.VITE_LIVE_ACCOUNT_FULFILLMENT_ENABLED === 'true'
  return Boolean(
    liveFulfillmentEnabled &&
      productGroup.auto_fulfill_enabled &&
      (productGroup.muabanvia_product_id ||
        productGroup.shopclone_product_id ||
        productGroup.shopviaclone_product_id),
  )
}

export function isCustomerSellableProduct(productGroup: ProductGroup) {
  const active = productGroup.is_active !== false
  const price = Number(productGroup.price)
  const validPrice = Number.isFinite(price) && price > 0
  const explicitSellable = productGroup.is_sellable
  const availabilityStatus = String(productGroup.availability_status || '').toUpperCase()
  const statusSellable = ['AVAILABLE', 'LOW_STOCK', 'PREORDER', 'BACKORDER', 'UNLIMITED'].includes(availabilityStatus)
  const statusBlocked = ['UNAVAILABLE', 'PAUSED'].includes(availabilityStatus)
  const blocked = explicitSellable === false || statusBlocked
  const available = !blocked && (statusSellable || Number(productGroup.stock_count || 0) > 0 || canAutoFulfillProduct(productGroup))
  return active && validPrice && available
}
