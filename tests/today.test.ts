import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentDate, matchMenus } from '../src/domain'
import { defaultFavorites, exampleMenus, restaurants, sources } from '../src/examples'
import { createMenuMatcher } from '../src/matching'
import { emptyMenuMessage, emptyScan } from '../src/scan-data'
import { nextStockholmMidnight, todayEmptyMessage, todayMatches } from '../src/today'

const matches = matchMenus([...exampleMenus('2026-11-23'), ...exampleMenus('2026-11-30')], sources, restaurants, defaultFavorites, createMenuMatcher())

test('Idag visar enbart träffar på valt datum, även när andra dagar har träffar', () => {
  assert.deepEqual(todayMatches(matches, '2026-11-23').map(match => match.dish.id), ['limpa'])
  assert.deepEqual(todayMatches(matches, '2026-11-25').map(match => match.dish.id), ['kyckling', 'bullar'])
  assert.deepEqual(todayMatches(matches, '2026-11-24'), [])
})

test('På helgen visas inga rätter från kommande vecka', () => {
  assert.deepEqual(todayMatches(matches, '2026-11-29'), [])
  const afterMidnight = todayMatches(matches, '2026-11-30')
  assert.equal(afterMidnight.length, 1)
  assert.equal(afterMidnight[0].dish.date, '2026-11-30')
})

test('Datumgränsen följer svensk vintertid, sommartid och dygn med tidsomställning', () => {
  for (const [before, boundary, date] of [
    ['2026-11-25T22:59:59.900Z', '2026-11-25T23:00:00.000Z', '2026-11-26'],
    ['2026-07-10T21:59:59.900Z', '2026-07-10T22:00:00.000Z', '2026-07-11'],
    ['2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z', '2026-10-26'],
    ['2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z', '2026-03-30'],
  ]) {
    const next = nextStockholmMidnight(Date.parse(before))
    assert.equal(new Date(next).toISOString(), boundary)
    assert.equal(currentDate(new Date(next)), date)
  }
})

test('Tomtexten skiljer favoritutfall, saknade menydata och misslyckad skanning', () => {
  const date = '2026-11-23'
  assert.equal(todayEmptyMessage(true, ''), 'Inga favoritträffar idag')
  assert.equal(todayEmptyMessage(false, emptyMenuMessage(emptyScan, date, false)), 'Inga tillgängliga menydata för veckan.')
  const failed = { ...emptyScan, targetWeek: date, results: [{ restaurantId: 'test', status: 'failed' as const }] }
  assert.equal(todayEmptyMessage(false, emptyMenuMessage(failed, date, false)), 'Menyskanningen misslyckades.')
})
