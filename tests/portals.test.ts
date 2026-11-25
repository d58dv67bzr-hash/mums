import assert from 'node:assert/strict'
import { test } from 'node:test'
import { combineScans } from '../scanner/combine'
import { createFetchSession } from '../scanner/collect'
import { collectPortals, type PortalAdapter, type PortalEntry, type PortalVenue } from '../scanner/portals'
import { matchMenus } from '../src/domain'
import { defaultFavorites } from '../src/examples'
import { createMenuMatcher } from '../src/matching'
import { emptyScan, menusForWeek, type ScanData } from '../src/scan-data'

const week = '2026-11-23'
const now = new Date('2026-11-25T09:00:00Z')

const portal = (id: string, url = `https://${id}.example/lunch`): PortalEntry => ({
  id, name: id, url, status: 'approved',
  review: { automatedAccessAllowed: true, termsEvidence: 'Testvillkor', robotsEvidence: 'Testpolicy' },
})

const venue = (key: string, name: string, locality: string, address?: string, priceSek?: number): PortalVenue => ({
  key, name, locality, address, menuUrl: '/lunch#' + key, website: 'https://testkrog.example/',
  menus: [{ week, dishes: [{ name: 'Köttfärslimpa', description: 'Med potatis.', date: week, priceSek }] }],
})
const a = portal('a')
const b = portal('b')
const alpha = venue('alpha', 'Testköket', 'Jönköping', 'Testgatan 1, 553 16 Jönköping', 149)
const beta = venue('beta', 'Testköket', 'Jönköping', 'Testgatan 1', 159)

function fixtures(contents: Record<string, PortalVenue[] | 'network' | number>) {
  const requests: string[] = []
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input))
    requests.push(url.href)
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /')
    const result = contents[url.hostname]
    if (result === 'network') throw new TypeError('Syntetiskt nätverksfel')
    if (typeof result === 'number') return new Response('', { status: result })
    return Response.json(result)
  }
  return { fetcher, requests }
}

// Testprotokoll för adaptergränssnittet. Det motsvarar ingen verklig portal.
const synthetic: PortalAdapter = {
  accepts: 'application/json',
  parse: ({ body, contentType }) => {
    assert.match(contentType, /application\/json/)
    return JSON.parse(body) as PortalVenue[]
  },
}
const adapters = { a: synthetic, b: synthetic }

test('Upptäcker flera restauranger och veckomenyer, och kräver uttryckligt angiven ort', async () => {
  const older = venue('old', 'Gammal meny', 'Jönköping', 'Testgatan 4')
  older.menus[0].week = '2026-10-19'
  const malformed = venue('invalid', 'Fel datum', 'Jönköping', 'Testgatan 6')
  malformed.menus[0].dishes[0].date = '2026-11-31'
  const { fetcher } = fixtures({ 'a.example': [
    alpha, venue('hus', 'Testbistron', 'Huskvarna'), venue('out', 'Utanför', 'Gränna'),
    venue('unknown', 'Okänd ort', '', 'Storgatan 3, Jönköping'), older, malformed,
  ] })
  const data = await collectPortals([a], adapters, { fetcher, week, now })
  assert.equal(data.restaurants.length, 4)
  assert.equal(data.menus.length, 2)
  assert.equal(data.restaurants[0].website, 'https://testkrog.example/')
  assert.match(data.sources[0].url, /#alpha$/)
  const again = await collectPortals([a], adapters, { fetcher, week, now })
  assert.deepEqual(data.restaurants.map(item => item.id), again.restaurants.map(item => item.id))
})

test('Samlar portaler och direkta källor, bevarar källor och avstår från motstridigt pris', async () => {
  const { fetcher } = fixtures({ 'a.example': [alpha], 'b.example': [beta, venue('annex', 'Testköket', 'Jönköping', 'Testgatan 9')] })
  const data = await collectPortals([a, b], adapters, { fetcher, week, now })
  const direct: ScanData = {
    ...emptyScan, targetWeek: week,
    restaurants: [{ id: 'direct', name: 'Testköket', area: 'Jönköping', address: 'Testgatan 1' }],
    sources: [{ id: 'direct', restaurantId: 'direct', kind: 'website', providerId: 'restaurang:direct', url: 'https://testkrog.example/meny' }],
    results: [{ restaurantId: 'direct', status: 'live' }],
    menus: [{ checkedAt: now.toISOString(), menu: { sourceId: 'direct', week, dishes: [
      { id: 'd', name: 'KÖTTFÄRSLIMPA', date: week, description: 'Med potatis.' },
      { id: 'e', name: 'Fläskfilé', date: '2026-11-24', description: 'Med murkelsås.', priceSek: 148 },
      { id: 'f', name: 'Köttbullar', date: '2026-11-25', description: 'Med gräddsås.' },
    ] } }],
  }
  const combined = combineScans(data, direct, [{ id: 'restaurang:direct', name: 'Restaurangens meny', status: 'live', active: true }])
  assert.equal(combined.restaurants.length, 2)
  const matches = matchMenus(combined.menus.map(item => item.menu), combined.sources, combined.restaurants, defaultFavorites, createMenuMatcher())
  assert.equal(matches.length, 4)
  const conflict = matches.find(item => item.dish.reports?.length === 3)!.dish
  assert.equal(conflict.priceConflict, true)
  assert.equal(conflict.priceSek, undefined)
  assert.deepEqual(conflict.reports?.map(item => [item.providerId, item.priceSek]), [['a', 149], ['b', 159], ['restaurang:direct', undefined]])
  assert.equal(matches.find(item => item.dish.name === 'Köttbullar')?.dish.priceSek, undefined)
  assert.equal(matches.find(item => item.dish.name === 'Fläskfilé')?.dish.priceSek, 148)
})

test('Namn utan verifierbar gatuadress räcker inte för att slå ihop två restauranger', async () => {
  const view = (key: string) => venue(key, 'Testköket', 'Jönköping', '553 16 Jönköping')
  const { fetcher } = fixtures({ 'a.example': [view('a')], 'b.example': [view('b')] })
  const data = await collectPortals([a, b], adapters, { fetcher, week, now })
  assert.equal(combineScans(data, emptyScan, []).restaurants.length, 2)
})

test('Hoppar över blockerade och ogranskade portaler, återanvänder svar under körningen', async () => {
  const { fetcher, requests } = fixtures({ 'a.example': [alpha] })
  const request = createFetchSession(fetcher)
  const data = await collectPortals([a, portal('b', a.url), { ...portal('pending'), status: 'manual-review' },
    portal('lokallunch', 'https://lokallunch.se/jonkoping/')], adapters, { request, week, now })
  assert.deepEqual(requests, ['https://a.example/robots.txt', a.url])
  assert.deepEqual(data.providers.map(item => item.status), ['live', 'live', 'manual-review', 'blocked'])
})

test('Tillfälliga fel stoppar inte övriga portaler och ger bara giltig reserv inom 48 timmar', async () => {
  const previous = await collectPortals([a], adapters, { fetcher: fixtures({ 'a.example': [alpha] }).fetcher, now, week })
  const failing = fixtures({ 'a.example': 'network', 'b.example': [beta] }).fetcher
  const data = await collectPortals([a, b], adapters, { fetcher: failing, now, week, previous })
  assert.deepEqual(data.providers.map(item => item.status), ['cached', 'live'])
  const combined = combineScans(data, emptyScan, [])
  const dish = combined.menus[0].menu.dishes[0]
  assert.equal(dish.reports?.[0].providerId, 'b')
  assert.equal(dish.priceSek, undefined)
  const old = await collectPortals([a], adapters, { fetcher: failing, now: new Date('2026-11-27T10:00:00Z'), week, previous })
  assert.equal(old.menus.length, 0)
  const denied = await collectPortals([a], adapters, { fetcher: fixtures({ 'a.example': 403 }).fetcher, now, week, previous })
  assert.equal(denied.providers[0].status, 'blocked')
  assert.equal(denied.menus.length, 0)
  const stale = new Date('2026-11-27T10:00:00Z').getTime()
  assert.deepEqual(menusForWeek(combined, week, stale)[0].menu.dishes[0].reports?.map(item => item.providerId), ['b'])
})

test('Publikt byggunderlag har inga menyer och exempelkälla filtreras ur normalläget', async () => {
  const { default: publicFeed } = await import('../public/menydata.json')
  assert.deepEqual(publicFeed.menus, [])
  assert.deepEqual(publicFeed.restaurants, [])
  const data = await collectPortals([a], adapters, { fetcher: fixtures({ 'a.example': [alpha] }).fetcher, now, week })
  const syntheticFeed = { ...data, sources: data.sources.map(item => ({ ...item, kind: 'example' as const })) }
  assert.equal(menusForWeek(syntheticFeed, week).length, 0)
  assert.equal(combineScans(syntheticFeed, emptyScan, []).menus.length, 0)
})
