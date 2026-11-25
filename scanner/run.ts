import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { currentDate, monday } from '../src/domain'
import { emptyScan, type ProviderResult, type ScanData } from '../src/scan-data'
import portals from '../data/lunch-portals.json'
import restaurants from '../data/restaurants.json'
import { collectMenus, createFetchSession } from './collect'
import { combineScans } from './combine'
import { collectPortals, portalAdapters, type PortalEntry } from './portals'
import { reviewedUrl, type RegistryEntry } from './registry'

const storage = new URL('../.mums/', import.meta.url)
const output = new URL('scan.json', storage)
const registry = restaurants as RegistryEntry[]
interface PrivateScan { portals: ScanData; restaurants: ScanData; feed: ScanData }

let previous: PrivateScan | undefined
try {
  previous = JSON.parse(await readFile(output, 'utf8'))
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
const now = new Date()
const week = monday(currentDate())
const request = createFetchSession(fetch, 750)
const portalData = await collectPortals(portals as PortalEntry[], portalAdapters, { request, week, now, previous: previous?.portals ?? emptyScan })
const restaurantData = await collectMenus(registry, { request, week, now, previous: previous?.restaurants ?? emptyScan })
const providerResults: ProviderResult[] = restaurantData.results.map(result => {
  const entry = registry.find(item => item.id === result.restaurantId)!
  let active = false
  try {
    active = Boolean(reviewedUrl(entry) && (entry.format === 'pdf' || entry.selector))
  } catch {
    // En felaktig URL redovisas av restaurangskannern.
  }
  return { id: 'restaurang:' + entry.id, name: entry.name, status: result.status, active }
})
const data = combineScans(portalData, restaurantData, providerResults)
await mkdir(storage, { mode: 0o700, recursive: true })
const temporary = new URL('scan-' + randomUUID() + '.tmp', storage)
await writeFile(temporary, JSON.stringify({ portals: portalData, restaurants: restaurantData, feed: data }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
await rename(temporary, output)
console.log(`Portaler: ${portalData.providers.length}. Aktiva källor: ${data.providers?.filter(item => item.active).length}. Restauranger med meny: ${data.restaurants.length}. Maträtter: ${data.menus.flatMap(item => item.menu.dishes).length}.`)
