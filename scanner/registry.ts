import type { Restaurant } from '../src/domain'

export interface RegistryEntry {
  id: string
  name: string
  address: string | null
  area: Restaurant['area'] | null
  menuUrl: string | null
  format: 'html' | 'pdf' | null
  priceFormat: 'per-dish' | 'shared' | 'mixed' | 'missing' | null
  status: 'manual-review' | 'approved' | 'blocked'
  lastChecked: string | null
  reviewAttempted: string | null
  review: { termsEvidence: string; robotsEvidence: string; automatedAccessAllowed: boolean } | null
  selector?: string
  adapter?: 'aqua' | 'huskvarna-stadshotell'
  leads?: { website?: string; historicalMenuUrl?: string; reportedAddress?: string; verified: false }
}

export const blockedHosts = ['lokallunch', 'tuggkoll']

export function reviewedUrl(entry: RegistryEntry) {
  if (entry.status !== 'approved' || entry.review?.automatedAccessAllowed !== true ||
    !entry.review.termsEvidence.trim() || !entry.review.robotsEvidence.trim() ||
    !entry.lastChecked || !entry.menuUrl || !entry.area || !entry.address || !entry.format || !entry.priceFormat) return
  const url = new URL(entry.menuUrl)
  if (url.protocol !== 'https:' || url.username || url.password || blockedHosts.some(host => url.hostname.split('.').includes(host))) return
  return url
}
