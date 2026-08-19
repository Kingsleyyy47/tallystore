import { useState } from 'react'
import { getCategoryStyle } from '@/lib/categoryStyles'
import { cn } from '@/lib/utils'

export default function CategoryLogo({
  name,
  className,
  iconClassName,
}: {
  name: string
  className?: string
  iconClassName?: string
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const style = getCategoryStyle(name)
  const Icon = style.icon

  if (style.image && !imageFailed) {
    return (
      <img
        src={style.image}
        alt=""
        aria-hidden="true"
        className={cn('h-5 w-5 shrink-0 rounded-[4px] object-cover', className)}
        loading="lazy"
        onError={() => setImageFailed(true)}
      />
    )
  }

  return <Icon className={cn('h-5 w-5 shrink-0', style.color, iconClassName || className)} />
}
