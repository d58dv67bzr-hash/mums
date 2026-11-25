import type { Dish, DishReport, Restaurant } from '../src/domain'
import { normalizeMenuText } from '../src/matching'
import type { ProviderResult, ScanData } from '../src/scan-data'
import { stableId } from './portals'

function identity(restaurant: Restaurant) {
  const name = normalizeMenuText(restaurant.name)
  const city = normalizeMenuText(restaurant.area)
  const address = normalizeMenuText(restaurant.address).replace(new RegExp(' ' + city + '$', 'u'), '')
    .replace(/\s+\d{3}\s?\d{2}$/u, '')
  return /\p{L}/u.test(address) && /\d/u.test(address) ? [city, name, address].join('|') : 'enskild|' + restaurant.id
}

interface Candidate {
  dish: Dish
  report: DishReport
}

export function combineScans(
  portals: ScanData, direct: ScanData, providerResults: ProviderResult[],
): ScanData {
  const providers = [...(portals.providers ?? []), ...providerResults]
  const byProvider = new Map(providers.map(provider => [provider.id, provider]))
  const venues = new Map<string, { restaurant: Restaurant; dishes: Map<string, Candidate[]> }>()
  // Portalernas registerordning vinner vid likvärdig aktualitet.
  const byPriority = new Map(providers.map((provider, index) => [provider.id, index]))
  for (const input of [portals, direct]) {
    const restaurants = new Map(input.restaurants.map(item => [item.id, item]))
    const sources = new Map(input.sources.map(item => [item.id, item]))
    const results = new Map(input.results.map(item => [item.restaurantId, item]))
    for (const restaurant of input.restaurants) {
      const key = identity(restaurant)
      const group = venues.get(key) ?? { restaurant: { ...restaurant, id: stableId(key), providerIds: [] }, dishes: new Map() }
      const ids = input.sources.filter(source => source.restaurantId === restaurant.id && source.providerId)
        .map(source => source.providerId!)
      group.restaurant.providerIds = [...new Set([...group.restaurant.providerIds ?? [], ...ids])]
      group.restaurant.website ??= restaurant.website
      venues.set(key, group)
    }
    for (const { menu, checkedAt } of input.menus) {
      const source = sources.get(menu.sourceId)
      const restaurant = source && restaurants.get(source.restaurantId)
      if (!restaurant || !source || source.kind !== 'website' || menu.week !== portals.targetWeek) continue
      const status = results.get(restaurant.id)?.status
      if (status !== 'live' && status !== 'cached') continue
      const key = identity(restaurant)
      const group = venues.get(key)!
      const providerId = source.providerId ?? source.id
      for (const dish of menu.dishes) {
        const dishKey = dish.date + '|' + normalizeMenuText(dish.name)
        const reports = group.dishes.get(dishKey) ?? []
        reports.push({ dish, report: { providerId, name: byProvider.get(providerId)?.name ?? restaurant.name,
          url: source.url, checkedAt, cached: status === 'cached', priceSek: dish.priceSek } })
        group.dishes.set(dishKey, reports)
      }
    }
  }

  const data: ScanData = { attemptedAt: portals.attemptedAt, targetWeek: portals.targetWeek, providers,
    results: [], menus: [], restaurants: [], sources: [] }
  if (!data.targetWeek) return data
  for (const { restaurant, dishes } of venues.values()) {
    let newest: DishReport | undefined
    const merged = [...dishes.entries()].map(([key, candidates]) => {
      candidates.sort((a, b) => Number(a.report.cached) - Number(b.report.cached) ||
        b.report.checkedAt.localeCompare(a.report.checkedAt) ||
        (byPriority.get(a.report.providerId) ?? Infinity) - (byPriority.get(b.report.providerId) ?? Infinity))
      const reports = [...new Map(candidates.map(({ report }) =>
        [JSON.stringify([report.providerId, report.url, report.priceSek]), report])).values()]
      const prices = new Set(reports.flatMap(report => report.priceSek === undefined ? [] : [report.priceSek]))
      const priceConflict = prices.size > 1 || candidates.some(({ dish }) => dish.priceConflict)
      const primary = reports[0]
      if (!newest || (newest.cached && !primary.cached) || (newest.cached === primary.cached && primary.checkedAt > newest.checkedAt)) newest = primary
      return { ...candidates[0].dish, id: stableId(restaurant.id + '|' + key), reports, priceConflict,
        priceSek: !priceConflict && prices.size === 1 ? prices.values().next().value : undefined }
    })
    data.restaurants.push(restaurant)
    if (!newest) continue
    data.sources.push({ id: restaurant.id, restaurantId: restaurant.id, url: newest.url, kind: 'website' })
    data.results.push({ restaurantId: restaurant.id, status: newest.cached ? 'cached' : 'live' })
    data.menus.push({ menu: { sourceId: restaurant.id, week: data.targetWeek, dishes: merged }, checkedAt: newest.checkedAt })
  }
  return data
}
