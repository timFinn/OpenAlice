import { fetchJson } from './client'

export interface PulseData {
  vix: number | null
  regime: string | null
  fearGreed: { score: number; label: string } | null
  termStructure: { shape: string; vix9d: number; vix: number; vix3m: number } | null
  skew: number | null
  signalCount: number
  lastSignal: Record<string, unknown> | null
}

export interface SignalEvent {
  type: 'signal' | 'routed'
  timestamp: string
  signalId?: string
  signalName?: string
  severity?: string
  summary?: string
  signals?: string[]
  reply?: string
  [key: string]: unknown
}

export interface PaperScorecard {
  account: string
  totalCommits: number
  overall: {
    totalTrades: number
    completedTrades?: number
    openPositions: number
    winRate?: number
    profitFactor?: number
  }
  bySignal: Record<string, { trades: number }>
  recentTrades: Array<{
    symbol: string
    signalTags: string[]
    entryTime: string
    exitTime: string | null
    status: string
  }>
}

export const dashboardApi = {
  async pulse(): Promise<PulseData> {
    return fetchJson('/api/dashboard/pulse')
  },
  async signals(limit = 30): Promise<{ events: SignalEvent[] }> {
    return fetchJson(`/api/dashboard/signals?limit=${limit}`)
  },
  async paperScorecard(account = 'alpaca-paper-auto'): Promise<PaperScorecard> {
    return fetchJson(`/api/dashboard/paper-scorecard?account=${account}`)
  },
}
