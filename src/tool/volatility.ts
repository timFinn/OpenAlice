/**
 * Volatility & Options Sentiment Tools
 *
 * Provides volatility regime awareness that mainstream price/news data lacks:
 * VIX term structure, SKEW index, put/call ratio proxy, and historical vol context.
 * All data sourced from index tickers via the existing equity client (yfinance).
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { EquityClientLike } from '@/domain/market-data/client/types.js'

// ==================== Helpers ====================

function buildStartDate(daysBack: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  return d.toISOString().slice(0, 10)
}

interface Bar { date: string; close: number; high?: number; low?: number; open?: number }

async function fetchCloseSeries(
  client: EquityClientLike,
  symbol: string,
  daysBack: number,
): Promise<Bar[]> {
  const raw = await client.getHistorical({
    symbol,
    start_date: buildStartDate(daysBack),
    interval: '1d',
    provider: 'yfinance',
  })
  return raw
    .filter((d): d is Record<string, unknown> & Bar => d.close != null)
    .map(d => ({
      date: d.date as string,
      close: d.close as number,
      high: d.high as number | undefined,
      low: d.low as number | undefined,
      open: d.open as number | undefined,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function last(bars: Bar[]): number | null {
  return bars.length > 0 ? bars[bars.length - 1].close : null
}

function avg(bars: Bar[], n: number): number | null {
  if (bars.length < n) return null
  const slice = bars.slice(-n)
  return slice.reduce((sum, b) => sum + b.close, 0) / n
}

function pctChange(current: number, previous: number): number {
  return previous === 0 ? 0 : ((current - previous) / previous) * 100
}

function round(n: number, d = 2): number {
  return parseFloat(n.toFixed(d))
}

// ==================== VIX Regime Classification ====================

function classifyVixRegime(vix: number): { regime: string; description: string } {
  if (vix < 12) return { regime: 'EXTREME_COMPLACENCY', description: 'Unusually low fear — often precedes volatility spikes' }
  if (vix < 16) return { regime: 'LOW_VOL', description: 'Calm markets, steady trend environment' }
  if (vix < 20) return { regime: 'NORMAL', description: 'Typical market conditions' }
  if (vix < 25) return { regime: 'ELEVATED', description: 'Above-average uncertainty — hedging activity increasing' }
  if (vix < 30) return { regime: 'HIGH', description: 'Significant fear — expect large daily swings' }
  if (vix < 40) return { regime: 'VERY_HIGH', description: 'Crisis-level fear — capitulation possible' }
  return { regime: 'EXTREME_FEAR', description: 'Panic selling — historically rare, often near bottoms' }
}

// ==================== Tool Factory ====================

export function createVolatilityTools(equityClient: EquityClientLike) {
  return {
    volatilityDashboard: tool({
      description: `Get a comprehensive volatility snapshot: VIX level & regime, VIX term structure
(contango/backwardation), SKEW index (tail risk pricing), and historical VIX context.

This tool provides volatility awareness that price and news data cannot:
- **VIX regime** classifies the current fear environment (complacency → panic)
- **Term structure** (VIX9D vs VIX vs VIX3M): contango = normal, backwardation = stress
- **SKEW** > 130 means options market is pricing elevated tail risk (crash hedging)
- **Historical context** shows where current VIX sits relative to recent ranges

Use this BEFORE making trading decisions during uncertain markets.
Use this to contextualize news sentiment — high VIX + bearish news = different from low VIX + bearish news.`,
      inputSchema: z.object({
        lookback: z.number().int().positive().optional().describe('Days of VIX history for context (default: 90)'),
      }),
      execute: async ({ lookback }) => {
        const days = lookback ?? 90

        // Fetch all series in parallel
        const [vixBars, vix9dBars, vix3mBars, skewBars] = await Promise.all([
          fetchCloseSeries(equityClient, '^VIX', days).catch(() => []),
          fetchCloseSeries(equityClient, '^VIX9D', days).catch(() => []),
          fetchCloseSeries(equityClient, '^VIX3M', days).catch(() => []),
          fetchCloseSeries(equityClient, '^SKEW', days).catch(() => []),
        ])

        const vix = last(vixBars)
        if (vix == null) return { error: 'Could not fetch VIX data.' }

        const vix9d = last(vix9dBars)
        const vix3m = last(vix3mBars)
        const skew = last(skewBars)

        // VIX regime
        const regime = classifyVixRegime(vix)

        // Term structure
        let termStructure: Record<string, unknown> | undefined
        if (vix9d != null && vix3m != null) {
          const frontToSpot = round(pctChange(vix9d, vix))
          const spotToBack = round(pctChange(vix3m, vix))
          const shape = vix9d < vix && vix < vix3m
            ? 'CONTANGO'
            : vix9d > vix && vix > vix3m
              ? 'BACKWARDATION'
              : 'MIXED'

          termStructure = {
            vix9d: round(vix9d),
            vix: round(vix),
            vix3m: round(vix3m),
            shape,
            frontToSpotPct: frontToSpot,
            spotToBackPct: spotToBack,
            interpretation: shape === 'BACKWARDATION'
              ? 'Short-term fear exceeds long-term — market expects imminent volatility event'
              : shape === 'CONTANGO'
                ? 'Normal structure — no imminent stress signal from options market'
                : 'Mixed signals — transitional period, watch for direction',
          }
        }

        // SKEW analysis
        let skewAnalysis: Record<string, unknown> | undefined
        if (skew != null) {
          const skewAvg = avg(skewBars, 20)
          skewAnalysis = {
            current: round(skew),
            sma20: skewAvg != null ? round(skewAvg) : null,
            tailRisk: skew > 140 ? 'ELEVATED' : skew > 130 ? 'ABOVE_NORMAL' : skew > 115 ? 'NORMAL' : 'LOW',
            interpretation: skew > 140
              ? 'Heavy crash hedging — institutions pricing significant tail risk'
              : skew > 130
                ? 'Above-normal tail hedging — elevated but not extreme'
                : 'Normal tail risk pricing',
          }
        }

        // Historical context
        const vixValues = vixBars.map(b => b.close)
        const vixHigh = Math.max(...vixValues)
        const vixLow = Math.min(...vixValues)
        const vixAvg = avg(vixBars, vixValues.length)
        const vixSma20 = avg(vixBars, 20)
        const percentile = round(
          (vixValues.filter(v => v <= vix).length / vixValues.length) * 100,
        )

        return {
          current: {
            vix: round(vix),
            ...regime,
          },
          ...(termStructure ? { termStructure } : {}),
          ...(skewAnalysis ? { skew: skewAnalysis } : {}),
          historicalContext: {
            periodDays: days,
            high: round(vixHigh),
            low: round(vixLow),
            average: vixAvg != null ? round(vixAvg) : null,
            sma20: vixSma20 != null ? round(vixSma20) : null,
            currentPercentile: percentile,
            interpretation: percentile > 80
              ? `VIX is in the top ${100 - percentile}% of its ${days}-day range — elevated relative to recent history`
              : percentile < 20
                ? `VIX is in the bottom ${percentile}% — unusually calm relative to recent history`
                : `VIX is at the ${percentile}th percentile of its ${days}-day range — typical`,
          },
        }
      },
    }),

    volatilityHistory: tool({
      description: `Get VIX time series data for charting or trend analysis.
Returns daily VIX closes over the requested period. Useful for spotting
volatility compression (VIX drifting lower) or expansion patterns.`,
      inputSchema: z.object({
        days: z.number().int().positive().optional().describe('Days of history (default: 30)'),
        includeSkew: z.boolean().optional().describe('Include SKEW index alongside VIX (default: false)'),
      }),
      execute: async ({ days, includeSkew }) => {
        const n = days ?? 30
        const fetches: Promise<Bar[]>[] = [
          fetchCloseSeries(equityClient, '^VIX', n).catch(() => []),
        ]
        if (includeSkew) {
          fetches.push(fetchCloseSeries(equityClient, '^SKEW', n).catch(() => []))
        }

        const [vixBars, skewBars] = await Promise.all(fetches)

        if (vixBars.length === 0) return { error: 'Could not fetch VIX history.' }

        const skewMap = new Map(skewBars?.map(b => [b.date, b.close]) ?? [])

        return {
          period: n,
          points: vixBars.map(b => ({
            date: b.date,
            vix: round(b.close),
            ...(includeSkew && skewMap.has(b.date) ? { skew: round(skewMap.get(b.date)!) } : {}),
          })),
        }
      },
    }),
  }
}
