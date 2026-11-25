import { createHash } from 'node:crypto'
import { addDays, currentDate, monday, type Dish, type Restaurant } from '../src/domain'
import { normalizeMenuText } from '../src/matching'
import { emptyScan, type ProviderResult, type ScanData } from '../src/scan-data'
import { createFetchSession, FetchFailure, verifyRobots } from './collect'
import { MenuFormatError } from './parse'

export interface PortalEntry {
  id: string
  name: string
  url: string
  status: 'manual-review' | 'approved' | 'blocked'
  reviewAttempted?: string
  reason?: string
  review: { termsEvidence: string; robotsEvidence: string; automatedAccessAllowed: boolean } | null
}

export interface PortalVenue {
  key: string
  name: string
  locality: string
  address?: string
  website?: string
  menuUrl?: string
  menus: { week: string; dishes: Omit<Dish, 'id' | 'reports'>[] }[]
}

export interface PortalAdapter {
  accepts: string
  parse(input: { body: string; contentType: string; url: URL; week: string }): readonly PortalVenue[]
}

export type PortalAdapters = Readonly<Record<string, PortalAdapter | undefined>>

// Registrera en adapter här när dess verkliga källa och format har verifierats.
export const portalAdapters: PortalAdapters = {}

const excluded = new Set(['lokallunch', 'tuggkoll'])
export function httpsUrl(value: string, base?: URL) {
  try {
    const url = new URL(value, base)
    if (url.protocol === 'https:' && !url.username && !url.password) return url
  } catch {
    return undefined
  }
}

export function portalUrl(entry: PortalEntry) {
  const url = httpsUrl(entry.url)
  if (!url || entry.status === 'blocked' || excluded.has(entry.id) ||
    url.hostname.split('.').some(part => excluded.has(part))) return
  return url
}

export function portalApproved(entry: PortalEntry) {
  return entry.status === 'approved' && entry.review?.automatedAccessAllowed === true &&
    Boolean(entry.review.termsEvidence.trim() && entry.review.robotsEvidence.trim())
}

export async function readPortal(url: URL, adapter: PortalAdapter, week: string, request: ReturnType<typeof createFetchSession>) {
  const { content, contentType, status } = await request(url, adapter.accepts)
  return { response: { status, contentType }, venues: adapter.parse({ body: content.toString('utf8'), contentType, url, week }) }
}

export const stableId = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 24)

function areaOf(locality: string): Restaurant['area'] | undefined {
  switch (normalizeMenuText(locality)) {
    case 'jönköping': return 'Jönköping'
    case 'huskvarna': return 'Huskvarna'
  }
}

function validDish(dish: Omit<Dish, 'id'>, week: string) {
  const date = new Date(dish.date + 'T00:00:00Z')
  return Boolean(dish.name.trim()) && Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === dish.date && dish.date >= week && dish.date <= addDays(week, 6)
}

export function portalDataset(entry: PortalEntry, url: URL, venues: readonly PortalVenue[], week: string, checkedAt: string) {
  const data: ScanData = { ...emptyScan, restaurants: [], sources: [], menus: [], results: [] }
  const ids = new Set<string>()
  for (const venue of venues) {
    const area = areaOf(venue.locality)
    const name = venue.name.trim()
    if (!area || !name || !venue.key.trim()) continue
    const id = 'portal:' + entry.id + ':' + stableId(venue.key)
    if (ids.has(id)) throw new MenuFormatError('Portalen returnerade samma restaurang-ID flera gånger.')
    ids.add(id)
    const link = venue.menuUrl ? httpsUrl(venue.menuUrl, url) : url
    if (!link || link.origin !== url.origin) continue
    const dishes = venue.menus.filter(menu => menu.week === week).flatMap(menu => menu.dishes)
      .filter(dish => validDish(dish, week)).map(dish => ({
        ...dish, id: stableId(id + '|' + dish.date + '|' + normalizeMenuText(dish.name)),
        priceSek: typeof dish.priceSek === 'number' && Number.isFinite(dish.priceSek) && dish.priceSek >= 0 ? dish.priceSek : undefined,
      }))
    data.restaurants.push({ id, name, area, address: venue.address?.trim() ?? '',
      website: venue.website ? httpsUrl(venue.website, url)?.href : undefined })
    data.sources.push({ id, restaurantId: id, url: link.href, kind: 'website', providerId: entry.id })
    if (dishes.length) data.menus.push({ menu: { sourceId: id, week, dishes }, checkedAt })
    data.results.push({ restaurantId: id, status: 'live' })
  }
  return data
}

export async function collectPortals(
  registry: readonly PortalEntry[], adapters: PortalAdapters,
  { fetcher = fetch, request = createFetchSession(fetcher), previous = emptyScan, week = monday(currentDate()), now = new Date() } = {},
) {
  const data: ScanData & { providers: ProviderResult[] } = {
    attemptedAt: now.toISOString(), targetWeek: week, results: [], providers: [], menus: [], restaurants: [], sources: [],
  }
  for (const entry of registry) {
    const url = portalUrl(entry)
    const adapter = adapters[entry.id]
    const active = Boolean(url && portalApproved(entry) && adapter)
    let status: ProviderResult['status'] = url ? 'manual-review' : 'blocked'
    let collected: ScanData | undefined
    if (active && url && adapter) {
      let robotsAllowed = false
      try {
        await verifyRobots(url, request)
        robotsAllowed = true
        const { venues } = await readPortal(url, adapter, week, request)
        collected = portalDataset(entry, url, venues, week, now.toISOString())
        if (!collected.menus.length) throw new MenuFormatError('Portalen saknar verifierbara menyer för målveckan.')
        status = 'live'
      } catch (error) {
        status = error instanceof FetchFailure ? error.status : 'failed'
        if (robotsAllowed && error instanceof FetchFailure && error.retryable &&
          previous.providers?.some(item => item.id === entry.id && item.origin === url.href)) {
          const sources = previous.sources.filter(source => source.providerId === entry.id)
          const menus = previous.menus.filter(({ checkedAt, menu }) => {
            const age = now.getTime() - Date.parse(checkedAt)
            return age >= 0 && age <= 48 * 3600000 && menu.week === week &&
              menu.dishes.length > 0 && menu.dishes.every(dish => validDish(dish, week)) &&
              sources.some(source => source.id === menu.sourceId)
          })
          if (menus.length) {
            const retained = sources.filter(source => menus.some(item => item.menu.sourceId === source.id))
            collected = { ...emptyScan, menus, sources: retained,
              restaurants: previous.restaurants.filter(restaurant => retained.some(source => source.restaurantId === restaurant.id)),
              results: retained.map(source => ({ restaurantId: source.restaurantId, status: 'cached' })) }
            status = 'cached'
          }
        }
      }
    }
    data.providers.push({ id: entry.id, name: entry.name, status, active, origin: url?.href })
    if (collected) {
      data.restaurants.push(...collected.restaurants)
      data.sources.push(...collected.sources)
      data.menus.push(...collected.menus)
      data.results.push(...collected.results)
    }
  }
  return data
}
