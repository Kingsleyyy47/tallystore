import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Plus, Minus, Package, ArrowRight } from 'lucide-react'
import { type ProductGroup, type Category, computeDiscountedTotal } from '@/lib/supabase'
import { useCurrency } from '@/contexts/CurrencyContext'
import CategoryLogo from '@/components/CategoryLogo'
import { canAutoFulfillProduct } from '@/lib/productAvailability'

interface ProductTemplateCardProps {
  productGroup: ProductGroup
  category: Category
  onPurchase: (productGroupId: string, quantity: number) => void
  onView?: (productGroup: ProductGroup) => void
}

export default function ProductTemplateCard({ 
  productGroup, 
  category, 
  onPurchase,
  onView,
}: ProductTemplateCardProps) {
  const [quantity, setQuantity] = useState(1)
  const { formatPrice } = useCurrency()

  // A product is purchasable if it has pre-stocked accounts, OR it's configured
  // to auto-fulfill live from any provider (MuaBanVia, ShopClone, ShopViaClone).
  // When any live provider is active, stock_count can legitimately be 0 and the
  // product is still buyable — process-purchase handles the live fulfillment
  // server-side. Gating purely on stock_count was blocking the buy button for
  // these products.
  const canAutoFulfill = canAutoFulfillProduct(productGroup)
  const isOutOfStock = productGroup.stock_count === 0 && !canAutoFulfill
  const isLowStock = productGroup.stock_count > 0 && productGroup.stock_count < 5
  // Quantity controls need an upper bound; use the pre-stocked count if any,
  // otherwise allow a small default range since a live provider fulfills on demand.
  const maxQuantity = productGroup.stock_count > 0 ? productGroup.stock_count : 10
  const { total: discountedTotal, discountPct } = computeDiscountedTotal(
    productGroup.price,
    quantity,
    productGroup.quantity_discount_tiers,
  )
  const bestTier = (productGroup.quantity_discount_tiers || [])
    .slice()
    .sort((a, b) => a.min_qty - b.min_qty)[0]
  const handleQuantityChange = (newQuantity: number) => {
    if (newQuantity >= 1 && newQuantity <= maxQuantity) {
      setQuantity(newQuantity)
    }
  }

  const handlePurchase = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    onPurchase(productGroup.id, quantity)
  }

  const handleView = () => {
    onView?.(productGroup)
  }

  const stopInteractiveClick = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
  }

  return (
    <Card
      className="group min-w-0 max-w-full cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white/90 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-purple-300 hover:shadow-lg dark:border-white/10 dark:bg-white/[0.035] dark:hover:border-purple-300/35"
      onClick={handleView}
      role="button"
      tabIndex={0}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ') && onView) {
          event.preventDefault()
          onView(productGroup)
        }
      }}
    >
      <CardHeader className="min-w-0 px-2 pb-2 pt-2 sm:px-3.5 sm:pb-2.5 sm:pt-3.5">
        <div className="mb-2 flex items-start justify-between gap-2 sm:mb-3 sm:gap-3">
          <CategoryLogo name={category.name} className="h-7 w-7 sm:h-10 sm:w-10" iconClassName="h-7 w-7 sm:h-9 sm:w-9" />
          {isLowStock && <Badge className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-black text-amber-700 hover:bg-amber-500/10 dark:text-amber-400">Low stock</Badge>}
        </div>
        <CardTitle
          className="max-w-full whitespace-normal break-words text-[13px] font-black leading-snug tracking-normal transition-colors [overflow-wrap:anywhere] [word-break:break-word] group-hover:text-purple-700 dark:group-hover:text-purple-300 sm:text-sm"
          title={productGroup.name}
        >
          {productGroup.name}
        </CardTitle>
        <Badge variant="outline" className="mt-1 w-fit max-w-full truncate rounded-full px-2 py-0.5 text-[11px]">
          {category.name}
        </Badge>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {productGroup.description}
        </p>
        {bestTier && (
          <p className="mt-1 hidden text-[10px] font-black text-emerald-600 dark:text-emerald-400 sm:block">
            Buy {bestTier.min_qty}+, save {bestTier.discount_pct}%
          </p>
        )}
      </CardHeader>

      <CardContent className="min-w-0 space-y-2 px-2 pb-2.5 pt-0 sm:space-y-2.5 sm:px-3.5 sm:pb-3.5">
        {/* Stock and Price Info */}
        <div className="flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0 max-w-full text-[11px] sm:text-xs">
            {isOutOfStock ? (
              <Badge variant="destructive" className="px-2 py-0.5 text-[11px]">Out of Stock</Badge>
            ) : isLowStock ? (
              <span className="font-semibold text-orange-700 dark:text-orange-400">
                {productGroup.stock_count} available
              </span>
            ) : productGroup.stock_count > 0 ? (
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {productGroup.stock_count} available
              </span>
            ) : (
              <span className="text-muted-foreground">Instant delivery</span>
            )}
          </span>
          <div className="min-w-0 text-left sm:text-right">
            <div className="break-words text-base font-black leading-tight text-slate-950 dark:text-white sm:text-lg">
              {formatPrice(productGroup.price)}
            </div>
          </div>
        </div>

        {/* Quantity Selection */}
        {!isOutOfStock && (
          <div className="flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <div className="flex items-center gap-1" aria-label="Quantity">
              <Button
                variant="outline"
                size="sm"
                aria-label="Decrease quantity"
                className="h-10 w-10 shrink-0 p-0"
                onClick={(event) => {
                  stopInteractiveClick(event)
                  handleQuantityChange(quantity - 1)
                }}
                disabled={quantity <= 1}
              >
                <Minus className="h-4 w-4" />
              </Button>

              <Input
                type="number"
                aria-label="Quantity"
                min="1"
                max={maxQuantity}
                value={quantity}
                onChange={(event) => {
                  stopInteractiveClick(event)
                  handleQuantityChange(parseInt(event.target.value) || 1)
                }}
                className="h-10 w-10 shrink-0 px-1 text-center text-sm"
                onFocus={stopInteractiveClick}
              />

              <Button
                variant="outline"
                size="sm"
                aria-label="Increase quantity"
                className="h-10 w-10 shrink-0 p-0"
                onClick={(event) => {
                  stopInteractiveClick(event)
                  handleQuantityChange(quantity + 1)
                }}
                disabled={quantity >= maxQuantity}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <span className="max-w-full break-words text-left text-xs font-bold text-primary sm:text-right">
              {discountPct > 0 && (
                <span className="block text-[10px] text-muted-foreground line-through font-normal">
                  {formatPrice(productGroup.price * quantity)}
                </span>
              )}
              Total: {formatPrice(discountedTotal)}
              {discountPct > 0 && <span className="ml-1 text-green-600">(-{discountPct}%)</span>}
            </span>
          </div>
        )}

        {/* Action Button */}
        {isOutOfStock ? (
          <Button disabled size="sm" className="h-11 w-full rounded-lg text-sm">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            Out of Stock
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={handlePurchase} className="h-11 w-full rounded-lg bg-purple-600 text-sm font-black hover:bg-purple-500">
            Buy Now
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
