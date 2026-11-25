export interface Restaurant {
  id: string
  name: string
  address: string
  area: 'Jönköping' | 'Huskvarna'
  website?: string
  providerIds?: string[]
}

export interface MenuSource {
  id: string
  restaurantId: string
  url: string
  kind: 'example' | 'website'
  providerId?: string
}

export interface DishReport {
  providerId: string
  name: string
  url: string
  checkedAt: string
  cached: boolean
  priceSek?: number
}

export interface Dish {
  id: string
  name: string
  description: string
  date: string
  priceSek?: number
  priceConflict?: boolean
  reports?: DishReport[]
}

export interface WeeklyMenu {
  sourceId: string
  week: string
  dishes: Dish[]
}

export interface Favorite {
  id: string
  name: string
  enabled: boolean
}

export interface Match {
  dish: Dish
  restaurant: Restaurant
  source: MenuSource
  favoriteIds: string[]
}

export interface MenuNotification {
  id: string
  matchId: string
  createdAt: string
  read: boolean
}

export interface MenuCollector {
  collect(week: string): Promise<WeeklyMenu[]>
}

export interface NotificationSender {
  send(notification: MenuNotification): Promise<void>
}

export type DishMatcher = (dish: Dish, favorite: Favorite) => boolean
const normalize = (value: string) => value.trim().normalize('NFC').toLocaleLowerCase('sv-SE')
const literalMatcher: DishMatcher = (dish, favorite) =>
  normalize(`${dish.name} ${dish.description}`).includes(normalize(favorite.name))

export function matchMenus(
  menus: WeeklyMenu[], sources: MenuSource[], restaurants: Restaurant[],
  favorites: Favorite[], matcher: DishMatcher = literalMatcher,
): Match[] {
  return menus.flatMap(menu => {
    const source = sources.find(item => item.id === menu.sourceId)
    const restaurant = restaurants.find(item => item.id === source?.restaurantId)
    if (!source || !restaurant) return []
    return menu.dishes.flatMap(dish => {
      const favoriteIds = favorites.filter(item => item.enabled && item.name.trim() && matcher(dish, item)).map(item => item.id)
      return favoriteIds.length ? [{ dish, source, restaurant, favoriteIds }] : []
    })
  }).sort((a, b) => a.dish.date.localeCompare(b.dish.date))
}

export function priceLabel(price?: number) {
  return price === undefined ? 'Pris saknas' : new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(price) + ' kr'
}

export function addDays(date: string, days: number) {
  const value = new Date(date + 'T00:00:00Z')
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function currentDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date())
}

export function monday(date: string) {
  const day = new Date(date + 'T00:00:00Z').getUTCDay()
  return addDays(date, -((day + 6) % 7))
}

export function weekNumber(date: string) {
  const thursday = new Date(addDays(monday(date), 3) + 'T00:00:00Z')
  return Math.ceil(((thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)
}

export function dateLabel(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('sv-SE', { ...options, timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'))
}
