import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectMenus, agent } from '../scanner/collect'
import { extractHtml, parseMenu } from '../scanner/parse'
import type { RegistryEntry } from '../scanner/registry'
import { createMenuMatcher, menuSynonyms } from '../src/matching'

const week = '2026-11-23'
const now = new Date('2026-11-25T09:00:00Z')
const text = `Vecka 48 2026
Lunchpris 130 kr
Måndag 23/11
Köttfärslimpa med lingon
Köttfärslimpa med lingon
Onsdag 25/11
Köttbullar med gräddsås 135 kr
Kyckling med murkelsås
Fredag 27/11
Ugnsbakad fisk`
const registry: RegistryEntry = {
  id: 'fixture', name: 'Testrestaurang', address: 'Testadress', area: 'Huskvarna',
  menuUrl: 'https://fixture.example/lunch', format: 'html', priceFormat: 'mixed',
  status: 'approved', lastChecked: '2026-11-25', reviewAttempted: '2026-11-25', selector: '#lunch',
  review: { termsEvidence: 'Testvillkor', robotsEvidence: 'Testpolicy', automatedAccessAllowed: true },
}
const html = '<section id="lunch">' + text.split('\n').map(line => '<p>' + line + '</p>').join('') + '</section>'

function mockFetch(options: { robots?: string; status?: number; menuHtml?: string } = {}) {
  const requests: string[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input)
    requests.push(url)
    assert.equal(new Headers(init?.headers).get('User-Agent'), agent)
    assert.equal(init?.redirect, 'manual')
    if (url.endsWith('/robots.txt')) {
      return new Response(options.robots ?? 'User-agent: *\nAllow: /', { headers: { 'Content-Type': 'text/plain' } })
    }
    return new Response(options.menuHtml ?? html, { status: options.status ?? 200, headers: { 'Content-Type': 'text/html' } })
  }
  return { fetcher, requests }
}

test('HTML extraheras med ett verifierat menyområde', () => {
  const menu = parseMenu(extractHtml(html, '#lunch'), 'fixture', week)
  assert.equal(menu.dishes.length, 4)
  assert.deepEqual(menu.dishes.map(dish => [dish.date, dish.priceSek]), [
    ['2026-11-23', 130], ['2026-11-25', undefined], ['2026-11-25', 130], ['2026-11-27', 130],
  ])
  assert.throws(() => extractHtml(html, '#gammal-selektor'), /Menyregionen/)
})

test('Gamla, odaterade, felaktiga och motsägande menyer avvisas', () => {
  for (const invalid of [
    text.replace('48 2026', '48 2025'), text.replace('23/11', '16/11'),
    text.replace('23/11', '31/11'), text.replace('23/11', '24/11'),
    'Vecka 48\nMåndag\nKöttbullar', 'Måndag\nKöttbullar', 'Måndag 23/11\nKöttbullar',
  ]) {
    assert.throws(() => parseMenu(invalid, 'fixture', week))
  }
  assert.equal(parseMenu('Vecka 53 2020\nFredag 1/1\nKöttbullar', 'fixture', '2020-12-28').dishes[0].date, '2021-01-01')
})

test('Dagspris blandas inte mellan dagar och prisdubbletter kan vara motstridiga', () => {
  const input = 'Vecka 48 2026\nMåndag\nLunchpris 129 kr\nKöttbullar\nTisdag\nSoppa\nOnsdag\nFisk 125 kr\nFisk 140 kr\nPasta 100 kr / 120 kr\nSallad från 110 kr\nBiff 1 295 kr'
  const menu = parseMenu(input, 'fixture', week)
  assert.deepEqual(menu.dishes.map(item => [item.name, item.priceSek]), [
    ['Köttbullar', 129], ['Soppa', undefined], ['Fisk', undefined], ['Pasta', undefined], ['Sallad', undefined], ['Biff', 1295],
  ])
})

test('Skanning kräver källgranskning och kontrollerar robots före menyn', async () => {
  const { fetcher, requests } = mockFetch()
  const result = await collectMenus([
    { ...registry, id: 'waiting', status: 'manual-review' },
    { ...registry, id: 'denied', menuUrl: 'https://sub.lokallunch.se/lunch' },
    { ...registry, id: 'incomplete', review: null },
    registry,
  ], { fetcher, week, now })
  assert.deepEqual(requests, ['https://fixture.example/robots.txt', registry.menuUrl])
  assert.deepEqual(result.results.map(item => item.status), ['manual-review', 'manual-review', 'manual-review', 'live'])
  assert.equal(result.sources[0].url, registry.menuUrl)
})

test('Robotsblockering, crawl-delay och trasiga selektorer stoppar insamlingen', async () => {
  for (const [options, expected, count] of [
    [{ robots: 'User-agent: MumsMenuScanner\nDisallow: /lunch' }, 'blocked', 1],
    [{ robots: 'User-agent: *\nCrawl-delay: 5' }, 'manual-review', 1],
    [{ menuHtml: '<p>Sidan har gjorts om.</p>' }, 'failed', 2],
  ] as const) {
    const { fetcher, requests } = mockFetch(options)
    const result = await collectMenus([registry], { fetcher, week, now })
    assert.equal(requests.length, count)
    assert.equal(result.results[0].status, expected)
    assert.equal(result.menus.length, 0)
  }
})

test('Återanvänder bara giltig meny vid tillfälligt fel och behåller kontrolltiden', async () => {
  const previous = await collectMenus([registry], { fetcher: mockFetch().fetcher, week, now })
  const options = { fetcher: mockFetch({ status: 503 }).fetcher, previous, week, now: new Date('2026-11-26T09:00:00Z') }
  const reused = await collectMenus([registry], options)
  assert.equal(reused.results[0].status, 'cached')
  assert.deepEqual(reused.menus, previous.menus)
  for (const change of [{ week: '2026-11-30' }, { now: new Date('2026-11-28T09:00:00Z') }, { fetcher: mockFetch({ status: 403 }).fetcher }]) {
    assert.deepEqual((await collectMenus([registry], { ...options, ...change })).menus, [])
  }
})

function textPdf(lines: string[]) {
  const stream = 'BT /F1 12 Tf 45 750 Td 18 TL ' + lines.map(line => '(' + line + ') Tj T*').join(' ') + ' ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const entries = objects.map((object, index) => {
    const offset = Buffer.byteLength(body, 'latin1')
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
    return String(offset).padStart(10, '0') + ' 00000 n \n'
  })
  const xref = Buffer.byteLength(body, 'latin1')
  return new Uint8Array(Buffer.from(body + 'xref\n0 6\n0000000000 65535 f \n' + entries.join('') +
    `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1'))
}

test('Extraherar text, datum och pris från en PDF genom pdftotext', async () => {
  const fetcher: typeof fetch = async url => String(url).endsWith('/robots.txt')
    ? new Response('User-agent: *\nAllow: /')
    : new Response(textPdf(['Vecka 48 2026', 'Måndag 23/11', 'Köttbullar 130 kr']), { headers: { 'Content-Type': 'application/pdf' } })
  const result = await collectMenus([{ ...registry, menuUrl: 'https://fixture.example/lunch.pdf', format: 'pdf' }], { fetcher, week, now })
  assert.equal(result.results[0].status, 'live')
  assert.equal(result.menus[0].menu.dishes[0].name, 'Köttbullar')
  assert.equal(result.menus[0].menu.dishes[0].priceSek, 130)
})

test('Matchar tillagning, svenska böjningar och murkelsynonymer utan falska svampträffar', () => {
  const matcher = createMenuMatcher()
  const matches = (name: string, favorite: string) =>
    matcher({ id: 'x', date: week, name, description: '' }, { id: 'y', name: favorite, enabled: true })
  for (const [favorite, dishes] of Object.entries({
    Köttfärslimpa: ['Köttfärslimpa', 'Baconlindad köttfärslimpa', 'Köttfärslimpa Lindström', 'Köttfärslimpan'],
    Murkelsås: ['Murkelsås', 'Murkelgräddsås', 'Fläskfilé med murkelsås'],
    Köttbullar: ['Köttbullar', 'Hemlagade köttbullar', 'Köttbullar med gräddsås', 'Köttbullarna'],
  })) for (const dish of dishes) assert.ok(matches(dish, favorite), dish)
  for (const dish of ['Champinjonsås', 'Svampsås', 'Murkelsåsigt']) assert.equal(matches(dish, 'Murkelsås'), false)
  for (const dish of ['Vegetariska köttbullar', 'Veganska köttbullar', 'Växtbaserade köttbullar']) {
    assert.equal(matches(dish, 'Köttbullar'), false)
  }
  assert.ok(matches('Vegetariska köttbullar', 'Vegetariska köttbullar'))
  const custom = createMenuMatcher({ ...menuSynonyms, köttbullar: [...menuSynonyms.köttbullar, 'vegetariska köttbullar'] })
  assert.ok(custom({ id: 'x', date: week, name: 'Vegetariska köttbullar', description: '' }, { id: 'y', name: 'Köttbullar', enabled: true }))
})
