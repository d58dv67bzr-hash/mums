import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight, Bell, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  ExternalLink, Heart, House, MapPin, Pencil, Plus, RefreshCw, Settings,
  Store, Trash2, Utensils, X,
} from 'lucide-react'
import { addDays, currentDate, dateLabel, matchMenus, monday, priceLabel, weekNumber, type Favorite, type Match } from './domain'
import { defaultFavorites, exampleCollector, exampleMenus, restaurants, sources } from './examples'
import { readLocal, writeLocal } from './storage'
import { createMenuMatcher } from './matching'
import { emptyMenuMessage, emptyScan, menusForWeek, type ScanData } from './scan-data'

const menuMatcher = createMenuMatcher()
const demo = new URLSearchParams(location.search).get('demo') === '1'
const sourceStatus = {
  live: 'Hämtad', cached: 'Tidigare hämtad', 'manual-review': 'Väntar på granskning',
  blocked: 'Blockerad', failed: 'Misslyckad',
}
const scanTime = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' })

const tabs = [
  { id: 'start', label: 'Start', icon: House },
  { id: 'vecka', label: 'Vecka', icon: CalendarDays },
  { id: 'favoriter', label: 'Favoriter', icon: Heart },
  { id: 'installningar', label: 'Inställningar', icon: Settings },
] as const
type Tab = typeof tabs[number]['id']

function activeTab(): Tab {
  return tabs.find(tab => '#' + tab.id === location.hash)?.id ?? 'start'
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} onCancel={onClose} aria-labelledby="dialog-title">
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2>
      <button className="icon-button" aria-label="Stäng" onClick={onClose}><X size={20} /></button>
    </div>
    {children}
  </dialog>
}

function Badge({ cached = false }: { cached?: boolean }) {
  if (!demo && !cached) return null
  return <span className="badge"><CircleHelp size={14} /> {demo ? 'Exempeldata' : 'Tidigare hämtad'}</span>
}

function DishRow({ match, showDay, cached, onClick }: { match: Match; showDay?: boolean; cached?: boolean; onClick: () => void }) {
  const { dish, restaurant } = match
  return <button className="dish-row" onClick={onClick}>
    <span className="dish-icon"><Utensils size={20} /></span>
    <span className="dish-copy">
      {showDay && <span className="day-tag">{dateLabel(dish.date, { weekday: 'long' })}</span>}
      <strong>{dish.name}</strong>
      <span className="restaurant">{restaurant.name} · {restaurant.area}</span>
      {cached && <Badge cached />}
    </span>
    <span className={'price' + (dish.priceSek === undefined ? ' missing' : '')}>{priceLabel(dish.priceSek)}</span>
    <ChevronRight className="dish-arrow" size={17} />
  </button>
}

export function App() {
  const [tab, setTab] = useState(activeTab)
  const [favorites, setFavorites] = useState(() => readLocal(demo ? 'demoFavorites' : 'favorites', defaultFavorites))
  const [weekOffset, setWeekOffset] = useState(0)
  const [selection, setSelection] = useState<Match>()
  const [notifications, setNotifications] = useState(false)
  const [editing, setEditing] = useState<Favorite | 'new'>()
  const [name, setName] = useState('')
  const [formError, setFormError] = useState('')
  const [storageError, setStorageError] = useState(false)
  const [lastScan, setLastScan] = useState(() => readLocal<string | null>('demoLastScan', null))
  const [scanResult, setScanResult] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanData, setScanData] = useState(emptyScan)
  const [dataState, setDataState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [scanned, setScanned] = useState<Awaited<ReturnType<typeof exampleCollector.collect>>>([])
  const thisWeek = monday(currentDate())
  const week = addDays(thisWeek, weekOffset * 7)
  const validMenus = menusForWeek(scanData, thisWeek)
  const matchesFor = (date: string) => demo
    ? matchMenus(scanned.some(menu => menu.week === date) ? scanned : exampleMenus(date), sources, restaurants, favorites, menuMatcher)
    : matchMenus(validMenus.map(item => item.menu).filter(menu => menu.week === date), scanData.sources, scanData.restaurants, favorites, menuMatcher)

  function emptyText(date: string) {
    if (demo) return 'Inga träffar i veckans exempelmenyer.'
    if (dataState === 'loading') return 'Hämtar menydata…'
    if (dataState === 'failed') return 'Menydata kunde inte hämtas.'
    return emptyMenuMessage(scanData, date, date === thisWeek && validMenus.length > 0)
  }

  function isCached(sourceId: string, match?: Match) {
    if (match?.dish.reports?.length) return match.dish.reports.every(report => report.cached)
    const source = scanData.sources.find(item => item.id === sourceId)
    return scanData.results.some(result => result.restaurantId === source?.restaurantId && result.status === 'cached')
  }

  async function loadScan(signal?: AbortSignal) {
    setDataState('loading')
    try {
      const response = await fetch('./menydata.json', { cache: 'no-cache', signal })
      if (!response.ok) throw new Error()
      const data: ScanData = await response.json()
      if (!data || !Array.isArray(data.menus) || !Array.isArray(data.results) ||
        !Array.isArray(data.sources) || !Array.isArray(data.restaurants) || (data.providers && !Array.isArray(data.providers))) throw new Error()
      setScanData(data)
      setDataState('ready')
    } catch {
      if (signal?.aborted) return
      setScanData(emptyScan)
      setDataState('failed')
    }
  }

  useEffect(() => {
    if (demo) return
    const controller = new AbortController()
    void loadScan(controller.signal)
    return () => controller.abort()
  }, [])
  const matches = matchesFor(thisWeek)
  const weekMatches = week === thisWeek ? matches : matchesFor(week)
  const days = [...new Set(weekMatches.map(match => match.dish.date))]

  useEffect(() => {
    function handleNavigation() {
      setTab(activeTab())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', handleNavigation)
    return () => window.removeEventListener('hashchange', handleNavigation)
  }, [])

  function updateFavorites(next: Favorite[]) {
    setFavorites(next)
    setStorageError(!writeLocal(demo ? 'demoFavorites' : 'favorites', next))
  }

  function openEditor(favorite: Favorite | 'new') {
    setName(favorite === 'new' ? '' : favorite.name)
    setFormError('')
    setEditing(favorite)
  }

  function saveFavorite(event: FormEvent) {
    event.preventDefault()
    const label = name.trim()
    if (!editing || !label) {
      setFormError('Skriv namnet på en maträtt.')
      return
    }
    if (favorites.some(item => (editing === 'new' || item.id !== editing.id) &&
      item.name.localeCompare(label, 'sv-SE', { sensitivity: 'accent' }) === 0)) {
      setFormError('Den maträtten finns redan bland dina favoriter.')
      return
    }
    updateFavorites(editing === 'new'
      ? [...favorites, { id: crypto.randomUUID(), name: label, enabled: true }]
      : favorites.map(item => item.id === editing.id ? { ...item, name: label } : item))
    setEditing(undefined)
  }

  async function scan() {
    setScanning(true)
    try {
      setScanned(await exampleCollector.collect(thisWeek))
      const timestamp = new Date().toISOString()
      setLastScan(timestamp)
      const saved = writeLocal('demoLastScan', timestamp)
      setScanResult(saved ? 'Exempelmenyerna har skannats.' : 'Exempelmenyerna har skannats. Skanningstiden kunde inte sparas.')
    } catch {
      setScanResult('Skanningen misslyckades. Försök igen.')
    } finally {
      setScanning(false)
    }
  }

  return <>
    <header className="topbar"><div className="top-inner">
      <a className="brand" href="#start" aria-label="Mums, start"><img src="/mark.svg" alt="" /><span>Mums<span className="brand-dot">.</span></span></a>
      <button className="icon-button bell" aria-label="Notiser" onClick={() => setNotifications(true)}><Bell size={21} /></button>
    </div></header>

    <main className="shell" id="main">
      {tab === 'start' && <>
        <section className="hero">
          <div className="hero-content">
            <p className="eyebrow"><MapPin size={15} /> Jönköping &amp; Huskvarna</p>
            <h1>Veckans lunchträffar</h1>
            <p className="hero-week">Vecka {weekNumber(thisWeek)}</p>
            <span className="hero-count"><span>{matches.length}</span> {matches.length === 1 ? 'träff' : 'träffar'} {demo ? 'i exempelmenyerna' : 'denna vecka'}</span>
          </div>
          <div className="hero-art" aria-hidden="true">
            <svg viewBox="0 0 240 190" fill="none">
              <circle cx="130" cy="97" r="85" stroke="currentColor" strokeDasharray="2 7" />
              <circle cx="130" cy="97" r="70" stroke="currentColor" strokeOpacity=".44" />
              <path d="M73 119a57 57 0 0 1 114 0M64 120h132m-115 12h98M130 61v-8m-7 0h14M120 43c-13-12 8-13 2-25m22 23c-8-10 9-11 4-20" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
              <path d="M43 62h14m-7-7v14m150 72h12m-6-6v12M185 35h8m-4-4v8M68 149h8m-4-4v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        </section>
        <section className="results">
          <div className="section-heading"><h2>Aktuella träffar</h2><Badge /></div>
          <div className="cards">{matches.map(match => <DishRow key={match.dish.id} match={match} showDay cached={isCached(match.source.id, match)} onClick={() => setSelection(match)} />)}</div>
          {matches.length === 0 && <p className="empty">{emptyText(thisWeek)}</p>}
        </section>
        <a className="week-link" href="#vecka" onClick={() => setWeekOffset(0)}>Visa hela veckan <ArrowRight size={17} /></a>
      </>}

      {tab === 'vecka' && <>
        <div className="page-heading"><h1>Vecka {weekNumber(week)}</h1><Badge /></div>
        <div className="week-picker">
          <button className="icon-button" aria-label="Föregående vecka" onClick={() => setWeekOffset(value => value - 1)}><ChevronLeft size={22} /></button>
          <strong>{dateLabel(week, { day: 'numeric', month: 'short' })} – {dateLabel(addDays(week, 6), { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
          <button className="icon-button" aria-label="Nästa vecka" onClick={() => setWeekOffset(value => value + 1)}><ChevronRight size={22} /></button>
        </div>
        {weekOffset !== 0 && <button className="text-button" onClick={() => setWeekOffset(0)}>Gå till denna vecka</button>}
        {days.map(day => <section className="day-group" key={day}>
          <h2>{dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <div className="cards">{weekMatches.filter(match => match.dish.date === day).map(match =>
            <DishRow key={match.dish.id} match={match} cached={isCached(match.source.id, match)} onClick={() => setSelection(match)} />)}</div>
        </section>)}
        {days.length === 0 && <p className="empty">{emptyText(week)}</p>}
      </>}

      {tab === 'favoriter' && <>
        <div className="page-heading"><h1>Favoriter</h1><button className="primary" onClick={() => openEditor('new')}><Plus size={18} /> Lägg till</button></div>
        <p className="intro">{favorites.filter(item => item.enabled).length} aktiva bevakningar</p>
        {storageError && <p role="alert">Ändringarna kunde inte sparas på den här enheten.</p>}
        <div className="cards">{favorites.map(favorite => <div className="favorite-row" key={favorite.id}>
          <span className="dish-icon"><Heart size={19} /></span>
          <strong>{favorite.name}</strong>
          <button className="icon-button compact" aria-label={'Redigera ' + favorite.name} onClick={() => openEditor(favorite)}><Pencil size={17} /></button>
          <button className="switch" type="button" role="switch" aria-checked={favorite.enabled} aria-label={'Bevaka ' + favorite.name}
            onClick={() => updateFavorites(favorites.map(item => item.id === favorite.id ? { ...item, enabled: !item.enabled } : item))}><span /></button>
        </div>)}</div>
        {favorites.length === 0 && <p className="empty">Du har inga favoriter ännu.</p>}
      </>}

      {tab === 'installningar' && <>
        <div className="page-heading"><h1>Inställningar</h1></div>
        <div className="settings-list">
          <div className="setting-row"><span className="dish-icon"><MapPin size={19} /></span><div><strong>Bevakningsområde</strong><p>Jönköping och Huskvarna</p></div></div>
          <div className="setting-row"><span className="dish-icon"><Bell size={19} /></span><div><strong>Pushnotiser</strong><p>Inte tillgängligt ännu</p></div><button className="switch" role="switch" aria-label="Pushnotiser" aria-checked={false} disabled><span /></button></div>
          <div className="setting-row"><span className="dish-icon"><Clock3 size={19} /></span><div><strong>Senaste menyskanning</strong><p>{(demo ? lastScan : scanData.attemptedAt) ? scanTime.format(new Date((demo ? lastScan : scanData.attemptedAt)!)) : 'Ingen skanning tillgänglig'}</p></div></div>
          <div className="setting-row"><span className="dish-icon"><Store size={19} /></span><div><strong>Bevakade restauranger</strong><p>{demo ? restaurants.length + ' i exempeldata' : scanData.restaurants.length}</p></div></div>
        </div>
        {!demo && <div className="settings-list source-settings">
          <div className="setting-row"><span className="dish-icon"><ExternalLink size={19} /></span><div><strong>Aktiva informationskällor</strong><p>{scanData.providers?.filter(item => item.active).length ?? 0}</p></div></div>
          <div className="setting-row"><span className="dish-icon"><Utensils size={19} /></span><div><strong>Inlästa maträtter</strong><p>{validMenus.reduce((total, item) => total + item.menu.dishes.length, 0)}</p></div></div>
          {!!scanData.providers?.length && <details className="source-details">
            <summary>Status per informationskälla</summary>
            <ul>{scanData.providers.map(item => <li key={item.id}><span>{item.name}</span><span>{sourceStatus[item.status]}</span></li>)}</ul>
          </details>}
        </div>}
        <section className="scan-card"><div className="section-heading"><h2>Menyskanning</h2><Badge /></div>
          {demo ? <>
            <button className="primary" disabled={scanning} onClick={() => void scan()}><RefreshCw size={17} /> Skanna exempelmenyer</button>
            <p className="scan-status" role="status">{scanResult}</p>
          </> : <>
            <p role="status">{dataState === 'loading' ? 'Hämtar skanningsstatus…'
              : dataState === 'failed' ? 'Skanningsstatus kunde inte hämtas.'
              : !scanData.attemptedAt ? 'Ingen skanning tillgänglig.'
              : `${(scanData.providers ?? scanData.results).filter(item => item.status === 'manual-review').length} väntar på granskning · ${(scanData.providers ?? scanData.results).filter(item => item.status === 'blocked' || item.status === 'failed').length} blockerade eller misslyckade · ${validMenus.filter(({ menu }) => isCached(menu.sourceId)).length} återanvända`}</p>
            <button className="primary" disabled={dataState === 'loading'} onClick={() => void loadScan()}><RefreshCw size={17} /> Uppdatera menydata</button>
          </>}
        </section>
      </>}
    </main>

    <nav className="bottom" aria-label="Huvudnavigation"><div className="nav-inner">{tabs.map(({ id, label, icon: Icon }) =>
      <a href={'#' + id} key={id} aria-current={tab === id ? 'page' : undefined}><span><Icon size={22} /></span>{label}</a>
    )}</div></nav>

    {selection && <Modal title={selection.dish.name} onClose={() => setSelection(undefined)}>
      <Badge cached={isCached(selection.source.id, selection)} />
      <div className="detail-meta"><span>{dateLabel(selection.dish.date, { weekday: 'long', day: 'numeric', month: 'long' })}</span><strong>{priceLabel(selection.dish.priceSek)}</strong></div>
      <p>{selection.dish.description}</p>
      <div className="detail-address"><MapPin size={18} /><div><strong>{selection.restaurant.name}</strong><p>{selection.restaurant.address}</p></div></div>
      {selection.dish.reports?.length ? <div className="menu-links">
        {[...new Map(selection.dish.reports.map(report => [report.providerId + '|' + report.url, report])).values()].map(report =>
          <a className="primary" key={report.providerId + '|' + report.url} href={report.url} target="_blank" rel="noreferrer">{report.name} <ExternalLink size={16} /></a>)}
      </div> : <a className="primary" href={selection.source.url} target="_blank" rel="noreferrer">{demo ? 'Öppna exempelmenyn' : 'Öppna originalmenyn'} <ExternalLink size={16} /></a>}
    </Modal>}
    {notifications && <Modal title="Notiser" onClose={() => setNotifications(false)}><p>Pushnotiser är inte tillgängliga ännu.</p></Modal>}
    {editing && <Modal title={editing === 'new' ? 'Lägg till favorit' : 'Redigera favorit'} onClose={() => setEditing(undefined)}>
      <form onSubmit={saveFavorite}>
        <label htmlFor="favorite-name">Maträtt</label>
        <input id="favorite-name" value={name} onChange={event => setName(event.target.value)} autoFocus maxLength={80} />
        {formError && <p role="alert">{formError}</p>}
        <div className="form-actions">
          {editing !== 'new' && <button type="button" className="danger" onClick={() => {
            updateFavorites(favorites.filter(item => item.id !== editing.id))
            setEditing(undefined)
          }}><Trash2 size={17} /> Ta bort</button>}
          <button className="primary" type="submit">Spara favorit</button>
        </div>
      </form>
    </Modal>}
  </>
}
