import type { ProductGroup } from '@/lib/supabase'

type Region = { label: string; order: number }

const REGIONS: Array<{ pattern: RegExp; region: Region }> = [
  { pattern: /\b(?:US|USA|UNITED STATES)\b/i, region: { label: '🇺🇸 United States', order: 1 } },
  { pattern: /\b(?:UK|UNITED KINGDOM)\b/i, region: { label: '🇬🇧 United Kingdom', order: 2 } },
  { pattern: /\bCANADA\b/i, region: { label: '🇨🇦 Canada', order: 3 } },
  { pattern: /\bAUSTRALIA\b/i, region: { label: '🇦🇺 Australia', order: 4 } },
  { pattern: /\bBRAZIL\b/i, region: { label: '🇧🇷 Brazil', order: 5 } },
  { pattern: /\bFRANCE\b/i, region: { label: '🇫🇷 France', order: 6 } },
  { pattern: /\bGERMANY\b/i, region: { label: '🇩🇪 Germany', order: 7 } },
  { pattern: /\bINDIA\b/i, region: { label: '🇮🇳 India', order: 8 } },
  { pattern: /\b(?:THAILAND|TURKEY|KOREA|SINGAPORE|PHILLIPINES|PHILIPPINES|ASIAN|ASIA)\b/i, region: { label: '🌏 Asia', order: 9 } },
  { pattern: /\b(?:BELGIUM|ITALY|PORTUGAL|SPAIN|POLAND|UKRAINE|EUROPE|EU)\b/i, region: { label: '🇪🇺 Europe', order: 10 } },
  { pattern: /\b(?:QATAR|ISREAL|ISRAEL)\b/i, region: { label: '🌍 Middle East', order: 11 } },
  { pattern: /\b(?:RANDOM COUNTRY|FOREIGN|FORIEGN|MIXED)\b/i, region: { label: '🌍 Mixed regions', order: 12 } },
]

export function getProductRegion(name: string): Region {
  return REGIONS.find(({ pattern }) => pattern.test(name))?.region || { label: 'Other', order: 99 }
}

export function groupProductsByRegion(products: ProductGroup[]) {
  const groups = new Map<string, { region: Region; products: ProductGroup[] }>()
  products.forEach((product) => {
    const region = getProductRegion(product.name)
    const group = groups.get(region.label) || { region, products: [] }
    group.products.push(product)
    groups.set(region.label, group)
  })
  return [...groups.values()].sort((a, b) => a.region.order - b.region.order)
}
