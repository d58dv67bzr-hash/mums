import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import { addDays, monday, weekNumber, type Dish, type WeeklyMenu } from '../../src/domain'
import { normalizeMenuText } from '../../src/matching'
import { datesIn, MenuFormatError, pricesIn } from '../parse'

interface Layout {
  weekTitle: string
  days: string
  dayTitle: string
  dishes: string
  name: string
  description: string
  lunchPrice: string
  dishPrice: string
}

type RestaurantAdapter = (html: string, selector: string, sourceId: string, week: string) => WeeklyMenu
type MenuNode = ReturnType<ReturnType<typeof load>>

const dayNames = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag']
const takeaway = /\b(?:avhämtning|take[ -]?away|hämtpris)\b/iu
const approximate = /\b(?:från|cirka|ca\.?|upp till)\s*\d/iu
const weekLabel = /\b(?:vecka|v\.)\s*(\d{1,2})(?:\s*[,/–-]?\s*(\d{4}))?\b/giu
const explicitYear = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}[/-]\d{4}\b/u

function plainText(node: MenuNode) {
  return node.text().replace(/\s+/gu, ' ').trim()
}

function uniqueText(node: MenuNode, selector: string, message: string) {
  const result = node.children(selector)
  if (result.length !== 1 || !plainText(result)) throw new MenuFormatError(message)
  return plainText(result)
}

function checkedDates(text: string, week: string) {
  const dates = datesIn(text, week)
  if (dates.some(date => monday(date) !== week)) throw new MenuFormatError('Menydatumet ligger utanför målveckan.')
  return dates
}

type Price = { amounts: number[]; uncertain: boolean }
function readPrices(lines: string[]): Price {
  // A combined line is unsafe unless each amount has its own field.
  return lines.reduce<Price>((result, line) => {
    const found = pricesIn(line)
    if (takeaway.test(line)) {
      if (found.length > 1 || /(?:ordinarie|på plats)/iu.test(line)) result.uncertain = true
      return result
    }
    if (approximate.test(line) || found.length !== 1) result.uncertain = true
    result.amounts.push(...found)
    return result
  }, { amounts: [], uncertain: false })
}

function structuredAdapter(layout: Layout): RestaurantAdapter {
  return (html, selector, sourceId, week) => {
    if (monday(week) !== week) throw new MenuFormatError('Målveckan måste börja på en måndag.')
    const $ = load(html)
    const region = $(selector)
    if (region.length !== 1 || !region.is('main,section,article,div')) throw new MenuFormatError('Menyregionen saknas eller är inte entydig.')
    region.find('script,style,noscript,template,[hidden],[aria-hidden="true"]').remove()
    region.find('br').replaceWith(' ')
    const weekTitle = uniqueText(region, layout.weekTitle, 'Menyns veckorubrik saknas eller har ändrats.')
    const labels = [...weekTitle.matchAll(weekLabel)]
    if (labels.length !== 1) throw new MenuFormatError('Menyns veckonummer är inte entydigt.')
    const [, labelWeek, labelYear] = labels[0]
    if (Number(labelWeek) !== weekNumber(week) || (labelYear && labelYear !== addDays(week, 3).slice(0, 4))) {
      throw new MenuFormatError('Menyn avser en annan vecka.')
    }
    checkedDates(weekTitle, week)
    let dated = Boolean(labelYear) || explicitYear.test(weekTitle)
    const prices = (node: MenuNode, field: string) =>
      readPrices(node.children(field).toArray().map(element => plainText($(element))))
    const common = prices(region, layout.lunchPrice)
    const groups = region.children(layout.days)
    if (!groups.length) throw new MenuFormatError('Menyns daggrupper saknas eller har ändrats.')
    const seenDays = new Set<string>()
    const dishes = new Map<string, { dish: Dish; individual: Price; daily: Price }>()
    for (const group of groups) {
      const day = $(group)
      const title = uniqueText(day, layout.dayTitle, 'Menyns dagsrubrik saknas eller har ändrats.')
      const weekday = dayNames.indexOf(/^[\p{L}]+/u.exec(title.toLocaleLowerCase('sv-SE'))?.[0] ?? '')
      if (weekday < 0) throw new MenuFormatError('Veckodagen kunde inte fastställas.')
      const date = addDays(week, weekday)
      if (checkedDates(title, week).some(value => value !== date)) throw new MenuFormatError('Veckodag och datum stämmer inte överens.')
      if (seenDays.has(date)) throw new MenuFormatError('Samma dagsrubrik förekommer flera gånger.')
      seenDays.add(date)
      dated ||= explicitYear.test(title)
      const daily = prices(day, layout.lunchPrice)
      const entries = day.children(layout.dishes)
      if (!entries.length) throw new MenuFormatError('Menystrukturen saknar identifierbara maträtter.')
      for (const entry of entries) {
        const row = $(entry)
        const name = uniqueText(row, layout.name, 'Maträttens namn saknas eller har ändrats.')
        const description = row.children(layout.description).toArray().map(element => plainText($(element))).filter(Boolean).join(' ')
        const individual = prices(row, layout.dishPrice)
        const key = date + '|' + normalizeMenuText(name)
        const previous = dishes.get(key)
        if (previous) {
          previous.individual.amounts.push(...individual.amounts)
          previous.individual.uncertain ||= individual.uncertain
          if (description && !previous.dish.description.includes(description)) previous.dish.description += ' ' + description
        } else {
          dishes.set(key, {
            dish: { id: createHash('sha256').update(sourceId + '|' + key).digest('hex').slice(0, 24),
              date, name, description: description ? name + '. ' + description : name },
            individual, daily,
          })
        }
      }
    }
    if (!dated) throw new MenuFormatError('Menyn saknar belägg för aktuellt år.')
    return { sourceId, week, dishes: [...dishes.values()].map(({ dish, individual, daily }) => {
      const price = individual.amounts.length || individual.uncertain
        ? individual
        : { amounts: [...common.amounts, ...daily.amounts], uncertain: common.uncertain || daily.uncertain }
      const amounts = new Set(price.amounts)
      if (amounts.size > 1) return { ...dish, priceConflict: true }
      return !price.uncertain && amounts.size === 1 ? { ...dish, priceSek: price.amounts[0] } : dish
    }) }
  }
}

// De här strukturprofilerna är testade mot källprov. Kontrollera dem mot den
// faktiska webbplatsens HTML innan en registerpost kan godkännas.
export const restaurantAdapters = {
  aqua: structuredAdapter({
    weekTitle: '.lunch-week', days: '.lunch-day', dayTitle: 'h3', dishes: '.lunch-dish',
    name: '.dish-name', description: '.dish-description', lunchPrice: '.lunch-price', dishPrice: '.dish-price',
  }),
  'huskvarna-stadshotell': structuredAdapter({
    weekTitle: '.menu-heading', days: '.menu-day', dayTitle: 'h3', dishes: '.menu-row',
    name: 'strong', description: '.menu-description', lunchPrice: '.menu-price', dishPrice: '.row-price',
  }),
} satisfies Record<string, RestaurantAdapter>
