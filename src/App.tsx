import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight, Bell, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  ExternalLink, Heart, House, MapPin, Pencil, Plus, RefreshCw, Settings,
  Store, Trash2, Utensils, X,
} from 'lucide-react'
import { addDays, currentDate, dateLabel, matchMenus, monday, priceLabel, weekNumber, type Favorite, type Match } from './domain'
import { defaultFavorites, exampleCollector, exampleMenus, restaurants, sources } from './examples'
import { readLocal, writeLocal } from './storage'

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

function Badge() {
  return <span className="badge"><CircleHelp size={14} /> Exempeldata</span>
}

function DishRow({ match, showDay, onClick }: { match: Match; showDay?: boolean; onClick: () => void }) {
  const { dish, restaurant } = match
  return <button className="dish-row" onClick={onClick}>
    <span className="dish-icon"><Utensils size={20} /></span>
    <span className="dish-copy">
      {showDay && <span className="day-tag">{dateLabel(dish.date, { weekday: 'long' })}</span>}
      <strong>{dish.name}</strong>
      <span className="restaurant">{restaurant.name} · {restaurant.area}</span>
    </span>
    <span className={'price' + (dish.priceSek === undefined ? ' missing' : '')}>{priceLabel(dish.priceSek)}</span>
    <ChevronRight className="dish-arrow" size={17} />
  </button>
}

export function App() {
  const [tab, setTab] = useState(activeTab)
  const [favorites, setFavorites] = useState(() => readLocal('favorites', defaultFavorites))
  const [weekOffset, setWeekOffset] = useState(0)
  const [selection, setSelection] = useState<Match>()
  const [notifications, setNotifications] = useState(false)
  const [editing, setEditing] = useState<Favorite | 'new'>()
  const [name, setName] = useState('')
  const [formError, setFormError] = useState('')
  const [storageError, setStorageError] = useState(false)
  const [lastScan, setLastScan] = useState(() => readLocal<string | null>('lastScan', null))
  const [scanResult, setScanResult] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<Awaited<ReturnType<typeof exampleCollector.collect>>>([])
  const thisWeek = monday(currentDate())
  const week = addDays(thisWeek, weekOffset * 7)
  const matchesFor = (date: string) => matchMenus(scanned.some(menu => menu.week === date) ? scanned : exampleMenus(date), sources, restaurants, favorites)
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
    setStorageError(!writeLocal('favorites', next))
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
      const saved = writeLocal('lastScan', timestamp)
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
            <span className="hero-count"><span>{matches.length}</span> {matches.length === 1 ? 'träff' : 'träffar'} i exempelmenyerna</span>
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
          <div className="cards">{matches.map(match => <DishRow key={match.dish.id} match={match} showDay onClick={() => setSelection(match)} />)}</div>
          {matches.length === 0 && <p className="empty">Inga träffar i veckans exempelmenyer.</p>}
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
            <DishRow key={match.dish.id} match={match} onClick={() => setSelection(match)} />)}</div>
        </section>)}
        {days.length === 0 && <p className="empty">Inga träffar i veckans exempelmenyer.</p>}
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
          <div className="setting-row"><span className="dish-icon"><Clock3 size={19} /></span><div><strong>Senaste menyskanning</strong><p>{lastScan ? new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(lastScan)) : 'Ingen skanning ännu'}</p></div></div>
          <div className="setting-row"><span className="dish-icon"><Store size={19} /></span><div><strong>Bevakade restauranger</strong><p>{restaurants.length} i exempeldata</p></div></div>
        </div>
        <section className="scan-card"><div className="section-heading"><h2>Menyskanning</h2><Badge /></div>
          <p>Automatisk insamling från restauranger är inte tillgänglig ännu.</p>
          <button className="primary" disabled={scanning} onClick={() => void scan()}><RefreshCw size={17} /> Skanna exempelmenyer</button>
          <p className="scan-status" role="status">{scanResult}</p>
        </section>
      </>}
    </main>

    <nav className="bottom" aria-label="Huvudnavigation"><div className="nav-inner">{tabs.map(({ id, label, icon: Icon }) =>
      <a href={'#' + id} key={id} aria-current={tab === id ? 'page' : undefined}><span><Icon size={22} /></span>{label}</a>
    )}</div></nav>

    {selection && <Modal title={selection.dish.name} onClose={() => setSelection(undefined)}>
      <Badge />
      <div className="detail-meta"><span>{dateLabel(selection.dish.date, { weekday: 'long', day: 'numeric', month: 'long' })}</span><strong>{priceLabel(selection.dish.priceSek)}</strong></div>
      <p>{selection.dish.description}</p>
      <div className="detail-address"><MapPin size={18} /><div><strong>{selection.restaurant.name}</strong><p>{selection.restaurant.address}</p></div></div>
      <a className="primary" href={selection.source.url} target="_blank" rel="noreferrer">Öppna exempelmenyn <ExternalLink size={16} /></a>
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
