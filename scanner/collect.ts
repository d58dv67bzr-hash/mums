import { spawn } from 'node:child_process'
import robotsParser from 'robots-parser'
import { monday, currentDate } from '../src/domain'
import { emptyScan, type ScanData, type ScannedMenu, type SourceStatus } from '../src/scan-data'
import { extractHtml, MenuFormatError, parseMenu } from './parse'
import { restaurantAdapters } from './adapters/restaurants'
import { reviewedUrl, type RegistryEntry } from './registry'

export const agent = 'MumsMenuScanner/1.0'
const maximumBytes = 6 * 1024 * 1024
const cacheHours = 48

export class FetchFailure extends Error {
  constructor(message: string, readonly status: SourceStatus, readonly retryable = false) {
    super(message)
  }
}

async function readResponse(url: URL, fetcher: typeof fetch, accepts: string) {
  let response: Response
  try {
    response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(12_000),
      headers: { 'User-Agent': agent, Accept: accepts } })
  } catch {
    throw new FetchFailure('Nätverksfel vid hämtning.', 'failed', true)
  }
  if (!response.ok) {
    await response.body?.cancel()
    const blocked = [401, 403, 429, 451].includes(response.status)
    throw new FetchFailure('HTTP ' + response.status, blocked ? 'blocked' : 'failed', response.status >= 500)
  }
  if (Number(response.headers.get('content-length')) > maximumBytes || !response.body) {
    await response.body?.cancel()
    throw new FetchFailure('Svaret är för stort eller tomt.', 'failed')
  }
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > maximumBytes) {
        await reader.cancel()
        throw new FetchFailure('Svaret är för stort.', 'failed')
      }
      parts.push(value)
    }
  } catch (error) {
    if (error instanceof FetchFailure) throw error
    throw new FetchFailure('Menyn kunde inte läsas från nätverket.', 'failed', true)
  } finally {
    reader.releaseLock()
  }
  return { status: response.status, content: Buffer.concat(parts), contentType: response.headers.get('content-type') ?? '' }
}

export function createFetchSession(fetcher = fetch, pauseMs = 0) {
  const replies = new Map<string, ReturnType<typeof readResponse>>()
  let queue: Promise<unknown> = Promise.resolve()
  let startAfter = 0
  let bytes = 0

  return function request(url: URL, accepts: string) {
    const key = url.href + '|' + accepts
    const previous = replies.get(key)
    if (previous) return previous
    const result = queue.then(async () => {
      const wait = startAfter - Date.now()
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
      startAfter = Date.now() + pauseMs
      const response = await readResponse(url, fetcher, accepts)
      bytes += response.content.length
      if (bytes > 24 * 1024 * 1024) {
        replies.clear()
        bytes = 0
      }
      return response
    })
    queue = result.catch(() => undefined)
    if (replies.size >= 80) replies.delete(replies.keys().next().value!)
    replies.set(key, result)
    return result
  }
}

export type FetchSession = ReturnType<typeof createFetchSession>

export function pdfText(content: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('pdftotext', ['-layout', '-enc', 'UTF-8', '-', '-'],
      { stdio: ['pipe', 'pipe', 'ignore'], timeout: 8000, killSignal: 'SIGKILL' })
    const parts: Buffer[] = []
    let length = 0
    process.stdout.on('data', (part: Buffer) => {
      length += part.length
      if (length > maximumBytes) process.kill('SIGKILL')
      else parts.push(part)
    })
    process.once('error', reject)
    process.once('close', code => {
      if (code === 0 && length <= maximumBytes) resolve(Buffer.concat(parts).toString('utf8'))
      else reject(new MenuFormatError('PDF-menyn kunde inte läsas som text.'))
    })
    process.stdin.on('error', reject)
    process.stdin.end(content)
  })
}

export async function verifyRobots(url: URL, request: FetchSession) {
  const robotsUrl = new URL('/robots.txt', url)
  try {
    const { content, contentType } = await request(robotsUrl, 'text/plain')
    const text = content.toString('utf8')
    if (/^\s*</u.test(text) || /text\/html/iu.test(contentType)) {
      throw new FetchFailure('robots.txt innehåller HTML.', 'manual-review')
    }
    const policy = robotsParser(robotsUrl.href, text)
    if (policy.isAllowed(url.href, agent) !== true) {
      throw new FetchFailure('robots.txt tillåter inte hämtning.', 'blocked')
    }
    const crawlDelay = policy.getCrawlDelay(agent)
    if (crawlDelay !== undefined && crawlDelay > 0) {
      throw new FetchFailure('Källans crawl-delay måste granskas innan hämtning.', 'manual-review')
    }
  } catch (error) {
    if (error instanceof FetchFailure && error.status === 'blocked') throw error
    throw new FetchFailure('robots.txt behöver granskas.' + (error instanceof FetchFailure ? ' ' + error.message : ''), 'manual-review')
  }
}

function reusable(previous: ScanData, id: string, url: URL, week: string, now: Date) {
  if (previous.sources.find(source => source.id === id)?.url !== url.href) return
  return previous.menus.find(({ menu, checkedAt }) => {
    const age = now.getTime() - Date.parse(checkedAt)
    return menu.sourceId === id && menu.week === week && age >= 0 && age <= cacheHours * 3600000 &&
      menu.dishes.length > 0 && menu.dishes.every(dish => monday(dish.date) === week)
  })
}

export async function collectMenus(
  registry: readonly RegistryEntry[],
  { fetcher = fetch, request = createFetchSession(fetcher), previous = emptyScan, week = monday(currentDate()), now = new Date() } = {},
): Promise<ScanData> {
  const data: ScanData = { attemptedAt: now.toISOString(), targetWeek: week, results: [], menus: [], sources: [], restaurants: [] }
  for (const entry of registry) {
    let url: URL | undefined
    let menu: ScannedMenu | undefined
    let status: SourceStatus = entry.status === 'blocked' ? 'blocked' : 'manual-review'
    let detail: string | undefined
    try {
      url = reviewedUrl(entry)
      if (url) {
        if (entry.format === 'html' && !entry.selector) throw new FetchFailure('Menyregionen behöver granskas.', 'manual-review')
        await verifyRobots(url, request)
        const pdf = entry.format === 'pdf'
        const { content, contentType } = await request(url, pdf ? 'application/pdf' : 'text/html')
        if (pdf ? !content.subarray(0, 5).equals(Buffer.from('%PDF-')) : !contentType.toLowerCase().includes('text/html')) {
          throw new MenuFormatError('Menyn bytte format eller svarade med oväntat innehåll.')
        }
        const parsed = pdf
          ? parseMenu(await pdfText(content), entry.id, week)
          : entry.adapter
            ? restaurantAdapters[entry.adapter](content.toString('utf8'), entry.selector!, entry.id, week)
            : parseMenu(extractHtml(content.toString('utf8'), entry.selector!), entry.id, week)
        menu = { menu: parsed, checkedAt: now.toISOString() }
        status = 'live'
      }
    } catch (error) {
      status = error instanceof FetchFailure ? error.status : 'failed'
      detail = error instanceof FetchFailure || error instanceof MenuFormatError ? error.message : 'Menyn kunde inte bearbetas.'
      if (url && error instanceof FetchFailure && error.retryable) {
        menu = reusable(previous, entry.id, url, week, now)
        if (menu) status = 'cached'
      }
    }
    data.results.push({ restaurantId: entry.id, status, detail })
    if (menu && url && entry.address && entry.area) {
      data.menus.push(menu)
      data.restaurants.push({ id: entry.id, name: entry.name, address: entry.address, area: entry.area })
      data.sources.push({ id: entry.id, restaurantId: entry.id, url: url.href, kind: 'website', providerId: 'restaurang:' + entry.id })
    }
  }
  return data
}
