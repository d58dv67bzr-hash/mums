import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addDays, matchMenus, monday, priceLabel, weekNumber } from '../src/domain'
import { defaultFavorites, exampleCollector, exampleMenus, restaurants, sources } from '../src/examples'
import { readLocal, writeLocal } from '../src/storage'

const week = '2026-11-23'
const menus = exampleMenus(week)

test('Matchar aktiva favoriter i menytexten och räknar varje rätt en gång', () => {
  const matches = matchMenus(menus, sources, restaurants, defaultFavorites)
  assert.equal(matches.length, 4)
  assert.equal(matches.filter(match => match.dish.date === '2026-11-25').length, 2)
  assert.deepEqual(matches.at(-1)?.favoriteIds, ['1', '2'])
  assert.equal(matches.at(-1)?.dish.priceSek, undefined)
})

test('Avaktiverade och tomma favoriter ger inga träffar', () => {
  const favorites = [{ id: 'a', name: 'Köttbullar', enabled: false }, { id: 'b', name: '  ', enabled: true }]
  assert.deepEqual(matchMenus(menus, sources, restaurants, favorites), [])
})

test('En meny utan känd källa eller restaurang hoppas över', () => {
  assert.deepEqual(matchMenus(menus, [], restaurants, defaultFavorites), [])
  assert.deepEqual(matchMenus(menus, sources, [], defaultFavorites), [])
})

test('Matchningen normaliserar skiftläge och gör synonymmatchning utbytbar', () => {
  assert.equal(matchMenus(menus, sources, restaurants, [{ id: 'a', name: '  MURKELSÅS ', enabled: true }]).length, 2)
  const synonym = [{ id: 'b', name: 'limpa', enabled: true }]
  assert.equal(matchMenus(menus, sources, restaurants, synonym, dish => dish.id === 'limpa').length, 1)
})

test('Visar källpris, nollpris och saknat pris separat', () => {
  assert.equal(priceLabel(undefined), 'Pris saknas')
  assert.equal(priceLabel(0), '0 kr')
  assert.equal(priceLabel(145.5), '145,5 kr')
})

test('Veckonavigering följer ISO-veckor även vid årsskiftet', () => {
  assert.equal(monday('2021-01-03'), '2020-12-28')
  assert.equal(weekNumber('2021-01-03'), 53)
  assert.equal(weekNumber(addDays(monday('2021-01-03'), 7)), 1)
})

test('Exempelskanningen hämtar bara menyer för den valda veckan', async () => {
  const target = addDays(week, 7)
  assert.ok((await exampleCollector.collect(target)).every(menu => menu.week === target))
})

test('Lokal lagring sparar ändringar och behåller en tom favoritlista', () => {
  const entries = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) },
  })
  try {
    assert.deepEqual(readLocal('favorites', defaultFavorites), defaultFavorites)
    assert.equal(writeLocal('favorites', []), true)
    assert.deepEqual(readLocal('favorites', defaultFavorites), [])
    entries.set('mums.favorites', '{')
    assert.deepEqual(readLocal('favorites', defaultFavorites), defaultFavorites)
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
