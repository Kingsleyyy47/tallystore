import { Link, useNavigate } from 'react-router-dom'
import { getCategoryStyle } from '@/lib/categoryStyles'
import type { Category, ProductGroup } from '@/lib/supabase'

interface CategorySidebarProps {
  categories: Category[]
  productGroups: ProductGroup[]
  selectedCategory?: string
  onSelectCategory?: (categoryId: string) => void
}

export default function CategorySidebar({
  categories,
  productGroups,
  selectedCategory = 'all',
  onSelectCategory,
}: CategorySidebarProps) {
  const navigate = useNavigate()

  const countFor = (categoryId: string) =>
    productGroups.filter((pg) => pg.category_id === categoryId && pg.is_active).length

  const handleClick = (categoryId: string) => {
    if (onSelectCategory) {
      onSelectCategory(categoryId)
    } else {
      navigate(`/category/${categoryId}`)
    }
  }

  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-muted-foreground px-3 mb-2">Categories</h3>

      {onSelectCategory && (
        <button
          onClick={() => onSelectCategory('all')}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
            selectedCategory === 'all'
              ? 'bg-primary/10 text-primary font-medium'
              : 'hover:bg-muted text-foreground'
          }`}
        >
          <span>All Categories</span>
          <span className="text-xs text-muted-foreground">{productGroups.length}</span>
        </button>
      )}

      {categories.map((category) => {
        const { icon: Icon, color } = getCategoryStyle(category.name)
        const isActive = selectedCategory === category.id
        const count = countFor(category.id)

        return (
          <button
            key={category.id}
            onClick={() => handleClick(category.id)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
              isActive ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground'
            }`}
          >
            <span className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${color}`} />
              {category.name}
            </span>
            <span className="text-xs text-muted-foreground">{count}</span>
          </button>
        )
      })}
    </div>
  )
}
