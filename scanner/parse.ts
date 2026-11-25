import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import { addDays, monday, weekNumber, type Dish, type WeeklyMenu } from '../src/domain'
import { normalizeMenuText } from '../src/matching'

const weekdays = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag']
const dayLine = /^(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?=\s|$|[:–-])/iu
const datePattern = /\b(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})(?:[/-](\d{4}))?)\b/gu
const weekPattern = /\b(?:vecka|v\.)\s*(\d{1,2})(?:\s*[,/–-]?\s*(\d{4}))?\b/giu
const pricePattern = /(?<![\d,.])(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{1,4})(?:[,.]\d{1,2})?\s*(?:kr\b|sek\b|:-)/giu
const sharedPrice = /^(?:lunchpris|dagens lunch(?:pris)?|pris för (?:dagens )?lunch)\s*(?::|–|-)?\s*(?=\d)/iu

export class MenuFormatError extends Error {}

export function extractHtml(html: string, selector: string) {
  const $ = load(html)
  const region = $(selector)
  if (region.length !== 1) throw new MenuFormatError('Menyregionen saknas eller är inte entydig.')
  region.find('script,style,noscript,template,[hidden]').remove()
  region.find('br').replaceWith('\n')
  region.find('div,p,h1,h2,h3,h4,h5,li,tr,section,article').before('\n').after('\n')
  region.find('td,th').after(' ')
  return region.text()
}

function explicitDate(year: number, month: number, day: number) {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const parsed = new Date(date + 'T00:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new MenuFormatError('Menyn innehåller ett ogiltigt datum.')
  }
  return date
}

export function datesIn(line: string, week: string) {
  const years = [...new Set([Number(week.slice(0, 4)), Number(addDays(week, 6).slice(0, 4))])]
  return [...line.matchAll(datePattern)].map(([, year, month, day, shortDay, shortMonth, shortYear]) => {
    const mm = Number(month ?? shortMonth)
    const dd = Number(day ?? shortDay)
    const explicitYear = year ?? shortYear
    if (explicitYear) return explicitDate(Number(explicitYear), mm, dd)
    const suffix = `-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    const candidates = Array.from({ length: 7 }, (_, index) => addDays(week, index)).filter(date => date.endsWith(suffix))
    return candidates[0] ?? explicitDate(years[0], mm, dd)
  })
}

export function pricesIn(text: string) {
  return [...new Set([...text.matchAll(pricePattern)].map(([price]) => Number.parseFloat(price.replace(/\s/gu, '').replace(',', '.'))))]
}

interface Candidate {
  dish: Dish
  seenPrices: Set<number>
  uncertainPrice: boolean
}

export function parseMenu(text: string, sourceId: string, week: string): WeeklyMenu {
  if (monday(week) !== week) throw new MenuFormatError('Målveckan måste börja på en måndag.')
  const expectedWeek = weekNumber(week)
  const expectedYear = Number(addDays(week, 3).slice(0, 4))
  const lines = text.split(/[\r\n\f]+/u).map(line => line.replace(/\s+/gu, ' ').trim()).filter(Boolean)
  const globalPrices = new Set<number>()
  const dailyPrices = new Map<string, Set<number>>()
  const candidates = new Map<string, Candidate>()
  let date: string | undefined
  let verifiedWeek = false
  let sawUndatedDish = false

  for (const line of lines) {
    const heading = dayLine.exec(line)
    const weekLabels = [...line.matchAll(weekPattern)]
    const hasWeekHeading = weekLabels.length > 0 && /^(?:lunchmeny\s*[:–-]?\s*|meny\s*[:–-]?\s*)?(?:vecka|v\.)/iu.test(line)
    const dateHeading = !heading && /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})(?=$|[\s–/-])/u.test(line)
    const isDateContext = heading || hasWeekHeading || dateHeading
    const dates = isDateContext ? datesIn(line, week) : []
    const datedWithYear = isDateContext && [...line.matchAll(datePattern)].some(([, year, , , , , shortYear]) => year || shortYear)
    if (dates.some(value => monday(value) !== week)) throw new MenuFormatError('Menydatumet ligger utanför målveckan.')
    if (hasWeekHeading) {
      for (const [, number, year] of weekLabels) {
        if (Number(number) !== expectedWeek || (year && Number(year) !== expectedYear)) {
          throw new MenuFormatError('Menyn avser en annan vecka.')
        }
        if (year || datedWithYear) verifiedWeek = true
      }
      date = undefined
      continue
    }
    if (heading || dateHeading) {
      if (dates.length > 1) {
        if (heading) throw new MenuFormatError('Flera datum på samma dagsrubrik.')
        if (datedWithYear) verifiedWeek = true
        date = undefined
        continue
      }
      const inferred = heading && addDays(week, weekdays.indexOf(heading[1].toLocaleLowerCase('sv-SE')))
      if (dates[0] && inferred && dates[0] !== inferred) throw new MenuFormatError('Veckodag och datum stämmer inte överens.')
      date = dates[0] || inferred || undefined
      if (datedWithYear) verifiedWeek = true
      continue
    }
    if (sharedPrice.test(line)) {
      const applicable = date ? dailyPrices.get(date) ?? new Set<number>() : globalPrices
      pricesIn(line).forEach(price => applicable.add(price))
      if (date) dailyPrices.set(date, applicable)
      continue
    }
    if (!date) continue
    if (!/[\p{L}]/u.test(line) || /^(?:pris|öppet|inkl\.|allergener|serveras kl|kaffe ingår)\b/iu.test(line)) continue
    if (!verifiedWeek) sawUndatedDish = true

    const price = pricesIn(line)
    const uncertainPrice = price.length > 0 && /\b(?:från|cirka|ca|upp till)\s*[:.]?\s*\d/iu.test(line)
    const name = line.replace(/^[-–•]\s*/u, '').replace(pricePattern, '').replace(/\s+(?:från|cirka|ca\.?|upp till)\s*$/iu, '').replace(/[\s,;|/–-]+$/u, '').trim()
    const normalized = normalizeMenuText(name)
    if (!normalized) continue
    const key = date + '|' + normalized
    const candidate = candidates.get(key) ?? {
      dish: { id: createHash('sha256').update(sourceId + '|' + key).digest('hex').slice(0, 24), name, description: name, date },
      seenPrices: new Set<number>(),
      uncertainPrice: false,
    }
    price.forEach(value => candidate.seenPrices.add(value))
    candidate.uncertainPrice ||= uncertainPrice
    candidates.set(key, candidate)
  }

  if (!verifiedWeek || sawUndatedDish || !candidates.size) throw new MenuFormatError('Veckan eller maträtterna kunde inte fastställas.')
  return {
    sourceId, week, dishes: [...candidates.values()].map(({ dish, seenPrices, uncertainPrice }) => {
      const applicable = new Set([...globalPrices, ...(dailyPrices.get(dish.date) ?? []), ...seenPrices])
      if (applicable.size > 1) return { ...dish, priceConflict: true }
      return !uncertainPrice && applicable.size === 1 ? { ...dish, priceSek: [...applicable][0] } : dish
    }),
  }
}
