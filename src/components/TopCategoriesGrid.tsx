import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { getCategories, getAllProductGroups, type Category, type ProductGroup } from '@/lib/supabase'
import { getCategoryStyle } from '@/lib/categoryStyles'

export default function TopCategoriesGrid() {
  const navigate = useNavigate()
  const [categories, setCategories] = useState<Category[]>([])
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    const loadData = async () => {
      try {
        const [categoriesData, productGroupsData] = await Promise.all([
          getCategories(),
          getAllProductGroups(),
        ])
        if (!isMounted) return
        setCategories(categoriesData)
        setProductGroups(productGroupsData)
      } catch (error) {
        console.error('Error loading top categories:', error)
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    loadData()
    return () => { isMounted = false }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  // Rank categories by number of active products, take the top 6
  const topCategories = [...categories]
    .map((category) => {
      const groups = productGroups.filter((pg) => pg.category_id === category.id && pg.is_active)
      const lowestPrice = groups.length ? Math.min(...groups.map((g) => g.price)) : null
      return { category, productCount: groups.length, lowestPrice }
    })
    .filter((entry) => entry.productCount > 0)
    .sort((a, b) => b.productCount - a.productCount)
    .slice(0, 6)

  if (topCategories.length === 0) return null

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {topCategories.map(({ category, productCount, lowestPrice }) => {
        const { icon: Icon, color, bg } = getCategoryStyle(category.name)
        return (
          <Card
            key={category.id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(`/category/${category.id}`)}
          >
            <CardContent className="pt-6 text-center">
              <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${bg}`}>
                <Icon className={`h-6 w-6 ${color}`} />
              </div>
              <h3 className="font-semibold text-sm mb-1">{category.name}</h3>
              <p className="text-xs text-muted-foreground">
                {productCount} product{productCount === 1 ? '' : 's'}
                {lowestPrice !== null && ` · from ₦${lowestPrice.toLocaleString()}`}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
