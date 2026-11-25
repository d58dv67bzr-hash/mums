import { addDays, type Favorite, type MenuCollector, type MenuSource, type Restaurant, type WeeklyMenu } from './domain'

export const defaultFavorites: Favorite[] = ['Köttfärslimpa', 'Murkelsås', 'Köttbullar'].map((name, index) => ({
  id: String(index), name, enabled: true,
}))

export const restaurants: Restaurant[] = [
  { id: 'linden', name: 'Kvarterskrogen Linden', address: 'Exempelgatan 12, Jönköping', area: 'Jönköping' },
  { id: 'vyn', name: 'Bistro Vyn', address: 'Exempelvägen 4, Huskvarna', area: 'Huskvarna' },
  { id: 'bordet', name: 'Lunchbordet', address: 'Exempeltorget 1, Jönköping', area: 'Jönköping' },
]

export const sources: MenuSource[] = restaurants.map(restaurant => ({
  id: restaurant.id, restaurantId: restaurant.id, kind: 'example', url: './exempelmeny.html#' + restaurant.id,
}))

export function exampleMenus(week: string): WeeklyMenu[] {
  return [
    { sourceId: 'linden', week, dishes: [
      { id: 'limpa', name: 'Köttfärslimpa', description: 'Köttfärslimpa med gräddsås, kokt potatis och rårörda lingon.', date: addDays(week, 0), priceSek: 129 },
    ] },
    { sourceId: 'vyn', week, dishes: [
      { id: 'kyckling', name: 'Kyckling med murkelsås', description: 'Ugnsstekt kyckling med murkelsås, potatispuré och haricots verts.', date: addDays(week, 2), priceSek: 145 },
    ] },
    { sourceId: 'bordet', week, dishes: [
      { id: 'bullar', name: 'Köttbullar', description: 'Hemgjorda köttbullar med potatispuré, gräddsås, pressgurka och lingon.', date: addDays(week, 2), priceSek: 135 },
      { id: 'fredag', name: 'Köttbullar med murkelsås', description: 'Köttbullar med murkelsås och rostad potatis.', date: addDays(week, 4) },
    ] },
  ]
}

export const exampleCollector: MenuCollector = {
  async collect(week) {
    return exampleMenus(week)
  },
}
