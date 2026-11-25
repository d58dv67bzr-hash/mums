import { currentDate, type Match } from './domain'

export function todayMatches(matches: readonly Match[], today: string) {
  return matches.filter(match => match.dish.date === today)
}

export function todayEmptyMessage(hasMenus: boolean, weekMessage: string) {
  return hasMenus ? 'Inga favoritträffar idag' : weekMessage
}

export function nextStockholmMidnight(now: number) {
  const today = currentDate(new Date(now))
  let low = now
  let high = now + 27 * 60 * 60 * 1000
  // Hitta nästa datumgräns även när dygnet har 23 eller 25 timmar.
  while (high - low > 1) {
    const middle = Math.floor((high + low) / 2)
    if (currentDate(new Date(middle)) === today) low = middle
    else high = middle
  }
  return high
}
