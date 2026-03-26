/**
 * Signal Definitions
 *
 * Each signal monitors a specific market condition and fires when
 * a meaningful change is detected. Signals are stateless functions —
 * the router manages previous-state comparison.
 */

import type { EquityClientLike } from '@/domain/market-data/client/types.js'
import type { SignalDefinition, SignalSnapshot, SignalEvent } from './types.js'

// ==================== Helpers ====================

async function fetchCloses(client: EquityClientLike, symbol: string, days: number): Promise<number[]> {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const raw = await client.getHistorical({
    symbol,
    start_date: d.toISOString().slice(0, 10),
    interval: '1d',
    provider: 'yfinance',
  })
  return raw
    .filter(r => r.close != null)
    .sort((a, b) => (a.date as string).localeCompare(b.date as string))
    .map(r => r.close as number)
}

function last(arr: number[]): number | null {
  return arr.length > 0 ? arr[arr.length - 1] : null
}

function sma(arr: number[], n: number): number | null {
  if (arr.length < n) return null
  const slice = arr.slice(-n)
  return slice.reduce((a, b) => a + b, 0) / n
}

// ==================== VIX Regime Signal ====================

const VIX_THRESHOLDS = [
  { level: 30, regime: 'VERY_HIGH' },
  { level: 25, regime: 'HIGH' },
  { level: 20, regime: 'ELEVATED' },
  { level: 16, regime: 'NORMAL' },
  { level: 12, regime: 'LOW' },
]

function classifyVixRegime(vix: number): string {
  for (const t of VIX_THRESHOLDS) {
    if (vix >= t.level) return t.regime
  }
  return 'EXTREME_COMPLACENCY'
}

export function createVixRegimeSignal(equityClient: EquityClientLike): SignalDefinition {
  return {
    id: 'vix-regime',
    name: 'VIX Regime Change',
    fetch: async () => {
      const closes = await fetchCloses(equityClient, '^VIX', 5)
      const vix = last(closes)
      return {
        timestamp: Date.now(),
        values: { vix, regime: vix != null ? classifyVixRegime(vix) : null },
      }
    },
    detect: (current, previous) => {
      const regime = current.values.regime as string | null
      const prevRegime = previous?.values.regime as string | null
      if (!regime || regime === prevRegime) return null
      const vix = current.values.vix as number
      return {
        signalId: 'vix-regime',
        signalName: 'VIX Regime Change',
        severity: regime === 'VERY_HIGH' || regime === 'EXTREME_COMPLACENCY' ? 'critical' : 'warning',
        summary: `VIX regime shifted from ${prevRegime ?? 'unknown'} to ${regime} (VIX: ${vix?.toFixed(1)})`,
        details: { vix, previousRegime: prevRegime, currentRegime: regime },
      }
    },
  }
}

// ==================== VIX Term Structure Signal ====================

export function createVixTermStructureSignal(equityClient: EquityClientLike): SignalDefinition {
  return {
    id: 'vix-term-structure',
    name: 'VIX Term Structure Inversion',
    fetch: async () => {
      const [vix9d, vix, vix3m] = await Promise.all([
        fetchCloses(equityClient, '^VIX9D', 3).then(last).catch(() => null),
        fetchCloses(equityClient, '^VIX', 3).then(last).catch(() => null),
        fetchCloses(equityClient, '^VIX3M', 3).then(last).catch(() => null),
      ])
      const shape = vix9d != null && vix != null && vix3m != null
        ? (vix9d < vix && vix < vix3m ? 'CONTANGO' : vix9d > vix ? 'BACKWARDATION' : 'MIXED')
        : null
      return {
        timestamp: Date.now(),
        values: { vix9d, vix, vix3m, shape },
      }
    },
    detect: (current, previous) => {
      const shape = current.values.shape as string | null
      const prevShape = previous?.values.shape as string | null
      if (!shape || shape === prevShape) return null
      // Only fire on transitions to/from backwardation (the stress signal)
      if (shape !== 'BACKWARDATION' && prevShape !== 'BACKWARDATION') return null
      return {
        signalId: 'vix-term-structure',
        signalName: 'VIX Term Structure Inversion',
        severity: shape === 'BACKWARDATION' ? 'critical' : 'info',
        summary: `VIX term structure shifted from ${prevShape} to ${shape}`,
        details: current.values,
      }
    },
  }
}

// ==================== Market Momentum Signal ====================

export function createMomentumSignal(equityClient: EquityClientLike): SignalDefinition {
  return {
    id: 'spy-momentum',
    name: 'SPY Momentum Cross',
    fetch: async () => {
      const closes = await fetchCloses(equityClient, 'SPY', 140)
      const price = last(closes)
      const ma50 = sma(closes, 50)
      const ma125 = sma(closes, 125)
      return {
        timestamp: Date.now(),
        values: {
          price,
          ma50,
          ma125,
          above50: price != null && ma50 != null ? price > ma50 : null,
          above125: price != null && ma125 != null ? price > ma125 : null,
        },
      }
    },
    detect: (current, previous) => {
      if (!previous) return null
      const above50 = current.values.above50 as boolean | null
      const prevAbove50 = previous.values.above50 as boolean | null
      const above125 = current.values.above125 as boolean | null
      const prevAbove125 = previous.values.above125 as boolean | null

      // 125-day cross is more significant
      if (above125 != null && prevAbove125 != null && above125 !== prevAbove125) {
        return {
          signalId: 'spy-momentum',
          signalName: 'SPY 125-Day MA Cross',
          severity: 'critical',
          summary: `SPY ${above125 ? 'crossed above' : 'broke below'} 125-day MA ($${(current.values.ma125 as number)?.toFixed(2)})`,
          details: current.values,
        }
      }

      // 50-day cross
      if (above50 != null && prevAbove50 != null && above50 !== prevAbove50) {
        return {
          signalId: 'spy-momentum',
          signalName: 'SPY 50-Day MA Cross',
          severity: 'warning',
          summary: `SPY ${above50 ? 'crossed above' : 'broke below'} 50-day MA ($${(current.values.ma50 as number)?.toFixed(2)})`,
          details: current.values,
        }
      }

      return null
    },
  }
}

// ==================== Fear & Greed Extreme Signal ====================

/**
 * Monitors a simplified fear/greed score derived from VIX.
 * Full fear/greed computation is expensive (many API calls), so this
 * uses VIX as a proxy and only fires on extremes.
 */
export function createFearGreedExtremeSignal(equityClient: EquityClientLike): SignalDefinition {
  return {
    id: 'fear-greed-extreme',
    name: 'Fear & Greed Extreme',
    fetch: async () => {
      const closes = await fetchCloses(equityClient, '^VIX', 5)
      const vix = last(closes)
      // Simplified score: VIX 10→95, VIX 20→50, VIX 35→5
      const score = vix != null ? Math.max(0, Math.min(100, 115 - 3.6 * vix)) : null
      const zone = score != null
        ? score >= 80 ? 'EXTREME_GREED'
          : score >= 60 ? 'GREED'
            : score >= 40 ? 'NEUTRAL'
              : score >= 20 ? 'FEAR'
                : 'EXTREME_FEAR'
        : null
      return {
        timestamp: Date.now(),
        values: { score, zone, vix },
      }
    },
    detect: (current, previous) => {
      const zone = current.values.zone as string | null
      const prevZone = previous?.values.zone as string | null
      if (!zone || zone === prevZone) return null
      // Only fire on extreme transitions
      const isExtreme = zone === 'EXTREME_FEAR' || zone === 'EXTREME_GREED'
      const wasExtreme = prevZone === 'EXTREME_FEAR' || prevZone === 'EXTREME_GREED'
      if (!isExtreme && !wasExtreme) return null
      return {
        signalId: 'fear-greed-extreme',
        signalName: 'Fear & Greed Extreme',
        severity: isExtreme ? 'critical' : 'info',
        summary: `Sentiment shifted from ${prevZone ?? 'unknown'} to ${zone} (score: ${(current.values.score as number)?.toFixed(0)})`,
        details: current.values,
      }
    },
  }
}

// ==================== Factory ====================

export function createAllSignals(equityClient: EquityClientLike): SignalDefinition[] {
  return [
    createVixRegimeSignal(equityClient),
    createVixTermStructureSignal(equityClient),
    createMomentumSignal(equityClient),
    createFearGreedExtremeSignal(equityClient),
  ]
}
