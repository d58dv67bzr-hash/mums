import { load } from 'cheerio'
import { currentDate, monday } from '../src/domain'
import portals from '../data/lunch-portals.json'
import restaurants from '../data/restaurants.json'
import { createFetchSession, verifyRobots } from './collect'
import { portalAdapters, portalApproved, portalDataset, portalUrl, type PortalEntry } from './portals'
import { reviewedUrl, type RegistryEntry } from './registry'

const week = monday(currentDate())
const request = createFetchSession(fetch, 750)
const safeError = (error: unknown) =>
  error instanceof Error && /^(?:HTTP |Nätverksfel|robots\.txt|Svaret är)/u.test(error.message)
    ? error.message : 'Svaret eller menystrukturen kunde inte verifieras.'

for (const entry of portals as PortalEntry[]) {
  const url = portalUrl(entry)
  if (!url) {
    console.log(entry.name + ' | Hoppas över. ' + (entry.reason ?? 'Källan är blockerad.'))
    continue
  }
  try {
    await verifyRobots(url, request)
    console.log(entry.name + ' | robots.txt tillåter den registrerade sökvägen.')
    if (!portalApproved(entry)) {
      console.log(entry.name + ' | Menysidan hoppas över i väntan på villkorsgranskning.')
      continue
    }
    const adapter = portalAdapters[entry.id]
    const { content, contentType, status } = await request(url, adapter?.accepts ?? 'text/html, application/json')
    const body = content.toString('utf8')
    const $ = contentType.includes('html') ? load(body) : undefined
    console.log(JSON.stringify({ källa: entry.name, url: url.href, status, innehållstyp: contentType,
      jsonLd: $?.('script[type="application/ld+json"]').length ?? 0,
      jsonSkript: $?.('script[type="application/json"]').length ?? 0,
      externaSkript: $?.('script[src]').length ?? 0,
      lunchtext: $ ? /\blunch\b/iu.test($('body').clone().find('script,style').remove().end().text()) : null }))
    if (!adapter) {
      console.log(entry.name + ' | Saknar verifierad adapter.')
      continue
    }
    const data = portalDataset(entry, url, adapter.parse({ body, contentType, url, week }), week, new Date().toISOString())
    console.log(JSON.stringify({ källa: entry.name, restauranger: data.restaurants.length, veckomenyer: data.menus.length }))
  } catch (error) {
    console.log(entry.name + ' | ' + url.href + ' | ' + safeError(error))
  }
}

for (const entry of restaurants as RegistryEntry[]) {
  try {
    const url = reviewedUrl(entry)
    if (!url) continue
    await verifyRobots(url, request)
    const { content, contentType, status } = await request(url, entry.format === 'pdf' ? 'application/pdf' : 'text/html')
    const regionCount = entry.format === 'html' && entry.selector ? load(content.toString('utf8'))(entry.selector).length : null
    console.log(JSON.stringify({ källa: entry.name, url: url.href, status, innehållstyp: contentType, menyregioner: regionCount }))
  } catch (error) {
    console.log(entry.name + ' | ' + safeError(error))
  }
}
