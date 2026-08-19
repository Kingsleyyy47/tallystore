import { ChevronRight, Home } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

type BreadcrumbItem = {
  label: string
  href?: string
}

export default function PageBreadcrumb({
  items,
  className,
}: {
  items: BreadcrumbItem[]
  className?: string
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400', className)}
    >
      <Link to="/" className="inline-flex shrink-0 items-center gap-1 transition hover:text-purple-600 dark:hover:text-purple-300">
        <Home className="h-3.5 w-3.5" />
        Home
      </Link>
      {items.map((item) => (
        <span key={`${item.href || 'current'}-${item.label}`} className="flex min-w-0 items-center gap-2">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          {item.href ? (
            <Link to={item.href} className="truncate transition hover:text-purple-600 dark:hover:text-purple-300">
              {item.label}
            </Link>
          ) : (
            <span className="truncate text-slate-800 dark:text-slate-200">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
