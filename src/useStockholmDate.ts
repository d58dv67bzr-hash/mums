import { useEffect, useState } from 'react'
import { currentDate } from './domain'
import { nextStockholmMidnight } from './today'

export function useStockholmDate() {
  const [date, setDate] = useState(() => currentDate())

  useEffect(() => {
    let timer: number
    function refresh() {
      window.clearTimeout(timer)
      const now = Date.now()
      setDate(currentDate(new Date(now)))
      timer = window.setTimeout(refresh, nextStockholmMidnight(now) - now)
    }

    refresh()
    window.addEventListener('pageshow', refresh)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return date
}
