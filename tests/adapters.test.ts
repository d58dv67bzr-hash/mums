import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { restaurantAdapters } from '../scanner/adapters/restaurants'
import { collectMenus } from '../scanner/collect'
import type { RegistryEntry } from '../scanner/registry'
import { matchMenus } from '../src/domain'
import { defaultFavorites } from '../src/examples'
import { createMenuMatcher } from '../src/matching'
import { emptyMenuMessage, emptyScan, menusForWeek, type ScanData } from '../src/scan-data'

const week = '2026-11-23'
const aqua = readFileSync(new URL('./fixtures/aqua-vecka-48-2026.html', import.meta.url), 'utf8')
const hotel = readFileSync(new URL('./fixtures/huskvarna-stadshotell-vecka-43.html', import.meta.url), 'utf8')
const parseAqua = (html: string) => restaurantAdapters.aqua(html, '#aqua-lunch', 'aqua', week)

test('Aqua använder ordinarie lunchpris och håller ihop rätt och tillbehör', () => {
  const { dishes } = parseAqua(aqua)
  assert.equal(dishes.length, 1)
  assert.equal(dishes[0].date, '2026-11-23')
  assert.equal(dishes[0].name, 'Köttfärslimpa')
  assert.match(dishes[0].description, /pressgurka, lingonsylt och kokt potatis/u)
  assert.equal(dishes[0].priceSek, 149)
  assert.equal(parseAqua(aqua.replace('Ordinarie lunch: 149 kr', 'Avhämtning: 120 kr')).dishes[0].priceSek, undefined)
})

test('Aqua väljer individuellt pris och avstår vid motstridiga eller sammanblandade priser', () => {
  const individual = aqua.replace('</article>', '<p class="dish-price">159 kr</p></article>')
  assert.equal(parseAqua(individual).dishes[0].priceSek, 159)
  assert.equal(parseAqua(individual.replace('159 kr', '159 kr / 169 kr')).dishes[0].priceSek, undefined)
  assert.equal(parseAqua(aqua.replace('Avhämtning: 120 kr', 'Ordinarie lunch: 150 kr')).dishes[0].priceSek, undefined)
  assert.equal(parseAqua(aqua.replace('Ordinarie lunch: 149 kr', 'Lunch 149 kr / Avhämtning 120 kr')).dishes[0].priceSek, undefined)
})

test('Aqua slår ihop dubbletter och ger ett stabilt rätt-ID', () => {
  const card = aqua.match(/<article[\s\S]+?<\/article>/u)![0]
  const duplicate = parseAqua(aqua.replace(card, card + card.replace('Köttfärslimpa', 'KÖTTFÄRSLIMPA')))
  assert.equal(duplicate.dishes.length, 1)
  assert.equal(duplicate.dishes[0].id, parseAqua(aqua).dishes[0].id)
  const conflict = aqua.replace(card, card.replace('</article>', '<p class="dish-price">159 kr</p></article>') +
    card.replace('</article>', '<p class="dish-price">169 kr</p></article>'))
  assert.equal(parseAqua(conflict).dishes[0].priceSek, undefined)
})

test('Adaptrarna avvisar fel veckonummer, fel datum och förändrad HTML', () => {
  for (const [html, message] of [
    [aqua.replace('48, 2026', '48, 2025'), /annan vecka/],
    [aqua.replace('48, 2026', '48'), /aktuellt år/],
    [aqua.replace('23/11', '24/11'), /stämmer inte överens/],
    [aqua.replace('23/11', '31/11'), /ogiltigt datum/],
    [aqua.replace('lunch-dish', 'ny-struktur'), /identifierbara maträtter/],
  ] as const) assert.throws(() => parseAqua(html), message)
  const parseHotel = (html: string) => restaurantAdapters['huskvarna-stadshotell'](html, '#hotel-lunch', 'hotel', week)
  assert.throws(() => parseHotel(hotel), /annan vecka/)
  const synthetic = hotel.replace('vecka 43', 'vecka 48, 2026').replace('Måndag', 'Måndag 23/11')
  assert.equal(parseHotel(synthetic).dishes[0].priceSek, 139)
  assert.throws(() => parseHotel(synthetic.replace('menu-heading', 'ny-rubrik')), /veckorubrik/)
})

const source = { id: 'aqua', restaurantId: 'aqua', url: 'https://fixture.example/lunch', kind: 'website' as const }
const restaurant = { id: 'aqua', name: 'Aqua', address: 'Testadress', area: 'Jönköping' as const }
const entry: RegistryEntry = {
  ...restaurant, menuUrl: source.url, format: 'html', priceFormat: 'mixed',
  status: 'approved', lastChecked: '2026-11-25', reviewAttempted: '2026-11-25',
  review: { termsEvidence: 'Testvillkor', robotsEvidence: 'Testpolicy', automatedAccessAllowed: true },
  adapter: 'aqua', selector: '#aqua-lunch',
}

test('Skannern väljer Aqua-adaptern och kan återanvända menyn vid nätverksfel', async () => {
  const now = new Date('2026-11-25T09:00:00Z')
  const fetcher: typeof fetch = async (url) => String(url).endsWith('/robots.txt')
    ? new Response('User-agent: *\nAllow: /')
    : new Response(aqua, { headers: { 'Content-Type': 'text/html' } })
  const previous = await collectMenus([entry], { fetcher, week, now })
  assert.equal(previous.results[0].status, 'live')
  assert.equal(previous.menus[0].menu.dishes[0].priceSek, 149)
  const disconnected: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/robots.txt')) return fetcher(url, init)
    throw new TypeError('Syntetiskt nätverksfel')
  }
  const retry = await collectMenus([entry], { fetcher: disconnected, previous, week, now })
  assert.equal(retry.results[0].status, 'cached')
  assert.deepEqual(retry.menus, previous.menus)
  let unreviewedRequests = 0
  const unreviewed: typeof fetch = async () => {
    unreviewedRequests++
    throw new TypeError('Källan får inte kontaktas')
  }
  const pending = await collectMenus([{ ...entry, status: 'manual-review' }], { fetcher: unreviewed, week, now })
  assert.equal(pending.results[0].status, 'manual-review')
  assert.equal(unreviewedRequests, 0)
})

test('Adapterresultat matchar köttfärslimpa, murkelsås och köttbullar', () => {
  const html = aqua.replace('</article>', `</article>
    <article class="lunch-dish"><h4 class="dish-name">Fläskfilé</h4><p class="dish-description">Med murkelgräddsås.</p></article>
    <article class="lunch-dish"><h4 class="dish-name">Hemlagade köttbullar</h4></article>
    <article class="lunch-dish"><h4 class="dish-name">Vegetariska köttbullar</h4></article>`)
  const matches = matchMenus([parseAqua(html)], [source], [restaurant], defaultFavorites, createMenuMatcher())
  assert.deepEqual(matches.map(item => item.dish.name), ['Köttfärslimpa', 'Fläskfilé', 'Hemlagade köttbullar'])
})

test('Appens menyfilter skiljer tomma data från misslyckad skanning och uteblivna matchningar', () => {
  const data: ScanData = {
    ...emptyScan, targetWeek: week, restaurants: [restaurant], sources: [source],
    results: [{ restaurantId: 'aqua', status: 'live' }],
    menus: [{ checkedAt: '2026-11-25T09:00:00Z', menu: parseAqua(aqua) }],
  }
  assert.equal(menusForWeek(data, week).length, 1)
  assert.equal(menusForWeek(data, '2026-11-30').length, 0)
  const stale = { ...data, menus: data.menus.map(item => ({ ...item, menu: { ...item.menu, week: '2026-10-19' } })) }
  assert.equal(menusForWeek(stale, week).length, 0)
  const staleDish = { ...data, menus: data.menus.map(item => ({ ...item, menu: {
    ...item.menu, dishes: item.menu.dishes.map(dish => ({ ...dish, date: '2026-10-19' })),
  } })) }
  assert.equal(menusForWeek(staleDish, week).length, 0)
  assert.equal(menusForWeek({ ...data, sources: [{ ...source, kind: 'example' }] }, week).length, 0)
  assert.equal(emptyMenuMessage(data, week, true), 'Inga matchande maträtter.')
  assert.equal(emptyMenuMessage(data, '2026-11-30', false), 'Inga tillgängliga menydata för veckan.')
  assert.equal(emptyMenuMessage({ ...data, results: [{ restaurantId: 'aqua', status: 'failed' }] }, week, false), 'Menyskanningen misslyckades.')
})
