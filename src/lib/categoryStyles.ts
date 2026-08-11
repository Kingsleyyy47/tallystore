// Maps category names to an icon + color theme so category lists/sidebars
// look consistent across the app without needing per-category DB columns.
import {
  Instagram,
  Twitter,
  Facebook,
  Youtube,
  MessageCircle,
  Mail,
  Globe,
  Smartphone,
  ShoppingBag,
  Tv,
  Music,
  LucideIcon,
} from 'lucide-react'

interface CategoryStyle {
  icon: LucideIcon
  color: string // tailwind text color class
  bg: string // tailwind bg color class (light tint)
}

const STYLE_MAP: Array<{ match: RegExp; style: CategoryStyle }> = [
  { match: /instagram/i, style: { icon: Instagram, color: 'text-pink-600', bg: 'bg-pink-50 dark:bg-pink-950/30' } },
  { match: /twitter|x\.com|^x$/i, style: { icon: Twitter, color: 'text-sky-500', bg: 'bg-sky-50 dark:bg-sky-950/30' } },
  { match: /facebook/i, style: { icon: Facebook, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' } },
  { match: /youtube/i, style: { icon: Youtube, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30' } },
  { match: /whatsapp|telegram|discord|chat/i, style: { icon: MessageCircle, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/30' } },
  { match: /email|gmail|mail/i, style: { icon: Mail, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30' } },
  { match: /tiktok|music|spotify/i, style: { icon: Music, color: 'text-fuchsia-600', bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/30' } },
  { match: /tv|netflix|stream/i, style: { icon: Tv, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30' } },
  { match: /sms|number|phone/i, style: { icon: Smartphone, color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-950/30' } },
  { match: /shop|store|account/i, style: { icon: ShoppingBag, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30' } },
]

const DEFAULT_STYLE: CategoryStyle = { icon: Globe, color: 'text-primary', bg: 'bg-primary/10' }

export function getCategoryStyle(categoryName: string): CategoryStyle {
  const found = STYLE_MAP.find(entry => entry.match.test(categoryName))
  return found ? found.style : DEFAULT_STYLE
}
