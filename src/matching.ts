import type { DishMatcher } from './domain'

export type Synonyms = Readonly<Record<string, readonly string[]>>

export function normalizeMenuText(text: string) {
  return text.normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export const menuSynonyms: Synonyms = {
  köttfärslimpa: ['köttfärslimpan', 'köttfärslimpor', 'köttfärslimporna'],
  murkelsås: ['murkelsåsen', 'murkelsåser', 'murkelsåserna', 'murkelgräddsås', 'murkelgräddsåsen', 'murkel gräddsås'],
  köttbullar: ['köttbulle', 'köttbullen', 'köttbullarna'],
}

const meatball = /^(?:köttbulle[n]?|köttbullar(?:na)?)$/u
const vegetarian = /(?:^| )(?:vegetari\p{L}*|vegan\p{L}*|växtbaserad\p{L}*|veg(?:o)?|quorn)(?= |$)/u

function contains(text: string, phrase: string) {
  return (' ' + text + ' ').includes(' ' + phrase + ' ')
}

export function createMenuMatcher(synonyms: Synonyms = menuSynonyms): DishMatcher {
  const groups = Object.entries(synonyms).map(([name, variants]) => [name, ...variants].map(normalizeMenuText).filter(Boolean))
  return (dish, favorite) => {
    const name = normalizeMenuText(favorite.name)
    if (!name) return false
    const title = normalizeMenuText(dish.name)
    const description = normalizeMenuText(dish.description)
    const candidates = [...new Set([name, ...groups.filter(group => group.includes(name)).flat()])]
    if (!vegetarian.test(name) && candidates.some(value => meatball.test(value)) &&
      (vegetarian.test(title) || vegetarian.test(description))) {
      return candidates.some(value => vegetarian.test(value) && (contains(title, value) || contains(description, value)))
    }
    return candidates.some(value => contains(title, value) || contains(description, value))
  }
}
