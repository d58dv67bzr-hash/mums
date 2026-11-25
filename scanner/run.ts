import { readFile, rename, writeFile } from 'node:fs/promises'
import { collectMenus } from './collect'
import type { RegistryEntry } from './registry'
import type { ScanData } from '../src/scan-data'

const registryPath = new URL('../data/restaurants.json', import.meta.url)
const output = new URL('../public/menydata.json', import.meta.url)
const temporary = new URL('../public/menydata.json.tmp', import.meta.url)

const registry: RegistryEntry[] = JSON.parse(await readFile(registryPath, 'utf8'))
const previous: ScanData = JSON.parse(await readFile(output, 'utf8'))
const data = await collectMenus(registry, { previous })
await writeFile(temporary, JSON.stringify(data, null, 2) + '\n')
await rename(temporary, output)
console.log(`Restauranger: ${registry.length}. Hämtade: ${data.results.filter(item => item.status === 'live').length}. Återanvända: ${data.results.filter(item => item.status === 'cached').length}. Maträtter: ${data.menus.flatMap(item => item.menu.dishes).length}.`)
