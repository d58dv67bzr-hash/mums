import type { MenuSource, Restaurant, WeeklyMenu } from './domain'

export type SourceStatus = 'live' | 'cached' | 'manual-review' | 'blocked' | 'failed'

export interface SourceResult {
  restaurantId: string
  status: SourceStatus
  detail?: string
}

export interface ScannedMenu {
  menu: WeeklyMenu
  checkedAt: string
}

export interface ScanData {
  attemptedAt: string | null
  targetWeek: string | null
  results: SourceResult[]
  menus: ScannedMenu[]
  restaurants: Restaurant[]
  sources: MenuSource[]
}

export const emptyScan: ScanData = {
  attemptedAt: null, targetWeek: null, results: [], menus: [], restaurants: [], sources: [],
}
