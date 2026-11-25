import { addDays, type MenuSource, type Restaurant, type WeeklyMenu } from './domain'

export type SourceStatus = 'live' | 'cached' | 'manual-review' | 'blocked' | 'failed'

export interface SourceResult {
  restaurantId: string
  status: SourceStatus
  detail?: string
}

export interface ProviderResult {
  id: string
  name: string
  status: SourceStatus
  active: boolean
  origin?: string
}

export interface ScannedMenu {
  menu: WeeklyMenu
  checkedAt: string
}

export interface ScanData {
  attemptedAt: string | null
  targetWeek: string | null
  results: SourceResult[]
  providers?: ProviderResult[]
  menus: ScannedMenu[]
  restaurants: Restaurant[]
  sources: MenuSource[]
}

export const emptyScan: ScanData = {
  attemptedAt: null, targetWeek: null, results: [], menus: [], restaurants: [], sources: [],
}

export function menusForWeek(data: ScanData, week: string, now = Date.now()) {
  if (data.targetWeek !== week) return []
  const end = addDays(week, 6)
  const isRecent = (checkedAt: string) => {
    const age = now - Date.parse(checkedAt)
    return age >= 0 && age <= 48 * 3600000
  }
  return data.menus.flatMap(item => {
    const { menu, checkedAt } = item
    const source = data.sources.find(item => item.id === menu.sourceId && item.kind === 'website')
    const status = data.results.find(item => item.restaurantId === source?.restaurantId)?.status
    if (!source || (status !== 'live' && status !== 'cached') || !data.restaurants.some(item => item.id === source.restaurantId)) return []
    if (menu.week !== week || !menu.dishes.length || !menu.dishes.every(dish => dish.date >= week && dish.date <= end)) return []
    if (status === 'cached' && !isRecent(checkedAt)) return []
    const dishes = menu.dishes.flatMap(dish => {
      if (!dish.reports?.length) return [dish]
      const reports = dish.reports.filter(report => !report.cached || isRecent(report.checkedAt))
      if (!reports.length) return []
      const priceSek = reports.some(report => report.priceSek === dish.priceSek) ? dish.priceSek : undefined
      return [{ ...dish, reports, priceSek }]
    })
    return dishes.length ? [{ ...item, menu: { ...menu, dishes } }] : []
  })
}

export function emptyMenuMessage(data: ScanData, week: string, hasMenus: boolean) {
  if (hasMenus) return 'Inga matchande maträtter.'
  if (data.targetWeek === week && [...data.results, ...(data.providers ?? [])].some(item => item.status === 'failed')) return 'Menyskanningen misslyckades.'
  return 'Inga tillgängliga menydata för veckan.'
}
