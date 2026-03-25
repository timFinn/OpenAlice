/**
 * Fear & Greed Composite Index
 *
 * Multi-factor sentiment score computed entirely from existing market data.
 * Modeled after CNN's Fear & Greed Index but computable without proprietary feeds.
 *
 * Factors (each scored 0-100, then averaged):
 * 1. VIX level — inverted (high VIX = fear)
 * 2. VIX term structure — contango = greed, backwardation = fear
 * 3. Market momentum — SPY vs 125-day MA
 * 4. Market breadth — advance/decline proxy via sector ETF performance
 * 5. Safe haven demand — treasury bond (TLT) vs equity (SPY) relative strength
 * 6. Junk bond demand — HYG vs investment-grade LQD spread
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

async function fetchCloses(
  client: EquityClientLike,
  symbol: string,
  daysBack: number,
): Promise<number[]> {
  const raw = await client.getHistorical({
    symbol,
    start_date: buildStartDate(daysBack),
    interval: '1d',
    provider: 'yfinance',
  })
  return raw
    .filter(d => d.close != null)
    .sort((a, b) => (a.date as string).localeCompare(b.date as string))
    .map(d => d.close as number)
}

function lastN(arr: number[], n: number): number[] {
  return arr.slice(-n)
}

function sma(data: number[], period: number): number | null {
  if (data.length < period) return null
  const slice = data.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

function round(n: number, d = 2): number {
  return parseFloat(n.toFixed(d))
}

/** Clamp a value to 0-100 range. */
function clamp(n: number): number {
  return Math.max(0, Math.min(100, n))
}

// ==================== Factor Scoring ====================

/**
 * VIX Level → 0-100 score.
 * VIX 10 = 95 (extreme greed), VIX 20 = 50 (neutral), VIX 35+ = 5 (extreme fear).
 * Uses an inverted sigmoid-like mapping.
 */
function scoreVixLevel(vix: number): number {
  // Linear mapping: VIX 10→95, VIX 20→50, VIX 35→5
  // score = 115 - 3.6 * vix (clamped)
  return clamp(115 - 3.6 * vix)
}

/**
 * VIX term structure → 0-100 score.
 * Contango (vix3m > vix > vix9d) = greed. Backwardation = fear.
 * Uses the ratio of front-month to spot VIX.
 */
function scoreTermStructure(vix9d: number, vix: number, vix3m: number): number {
  // Compute normalized slope: (vix3m - vix9d) / vix
  // Positive = contango (greed), negative = backwardation (fear)
  const slope = (vix3m - vix9d) / vix
  // slope of +0.15 → 80 (strong contango), 0 → 50, -0.15 → 20 (strong backwardation)
  return clamp(50 + slope * 200)
}

/**
 * Market momentum → 0-100 score.
 * SPY above 125-day MA = greed, below = fear.
 * Scaled by distance from MA.
 */
function scoreMomentum(current: number, ma125: number): number {
  const deviation = ((current - ma125) / ma125) * 100
  // +10% above MA → 90, at MA → 50, -10% below → 10
  return clamp(50 + deviation * 4)
}

/**
 * Market breadth → 0-100 score.
 * Measures how many sector ETFs are above their 50-day MA.
 * Broad participation = greed, narrow = fear.
 */
function scoreBreadth(sectorsAboveMa: number, totalSectors: number): number {
  if (totalSectors === 0) return 50
  return clamp((sectorsAboveMa / totalSectors) * 100)
}

/**
 * Safe haven demand → 0-100 score.
 * Compares TLT (treasury bonds) vs SPY relative 20-day performance.
 * When TLT outperforms SPY → fear (money flowing to safety).
 */
function scoreSafeHaven(spyReturn20d: number, tltReturn20d: number): number {
  // Spread: positive means SPY outperforming (greed), negative means TLT outperforming (fear)
  const spread = spyReturn20d - tltReturn20d
  // spread of +5% → 80, 0% → 50, -5% → 20
  return clamp(50 + spread * 6)
}

/**
 * Junk bond demand → 0-100 score.
 * HYG (high yield) vs LQD (investment grade) relative strength.
 * When HYG outperforms → greed (risk appetite). LQD outperforms → fear.
 */
function scoreJunkBondDemand(hygReturn20d: number, lqdReturn20d: number): number {
  const spread = hygReturn20d - lqdReturn20d
  // spread of +2% → 80, 0% → 50, -2% → 20
  return clamp(50 + spread * 15)
}

// ==================== Composite ====================

function classifyScore(score: number): string {
  if (score >= 80) return 'EXTREME_GREED'
  if (score >= 60) return 'GREED'
  if (score >= 45) return 'NEUTRAL'
  if (score >= 25) return 'FEAR'
  return 'EXTREME_FEAR'
}

interface FactorResult {
  name: string
  score: number
  weight: number
  detail: string
}

// ==================== Tool Factory ====================

const SECTOR_ETFS = ['XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC']

export function createFearGreedTools(equityClient: EquityClientLike) {
  return {
    fearGreedIndex: tool({
      description: `Compute a composite Fear & Greed index (0-100) from 6 market factors.

0 = Extreme Fear, 50 = Neutral, 100 = Extreme Greed.

Factors measured:
1. **VIX level** — current implied volatility regime
2. **VIX term structure** — contango (calm) vs backwardation (stress)
3. **Market momentum** — SPY distance from 125-day moving average
4. **Market breadth** — sector participation (how many sectors trending up)
5. **Safe haven demand** — treasury bonds vs equities relative strength
6. **Junk bond demand** — high-yield vs investment-grade bond appetite

Each factor scores 0-100 independently, then they're weighted-averaged.
Use this alongside volatilityDashboard and marketMood for a complete sentiment picture.

Unlike CNN's index (which is a black box), this shows the exact score and reasoning
for each factor, so you can explain to the user WHY markets feel fearful or greedy.`,
      inputSchema: z.object({}),
      execute: async () => {
        const factors: FactorResult[] = []
        let totalWeight = 0
        let weightedSum = 0

        const addFactor = (f: FactorResult) => {
          factors.push(f)
          totalWeight += f.weight
          weightedSum += f.score * f.weight
        }

        // 1. VIX level (weight: 2 — most reliable fear signal)
        try {
          const vixCloses = await fetchCloses(equityClient, '^VIX', 5)
          if (vixCloses.length > 0) {
            const vix = vixCloses[vixCloses.length - 1]
            addFactor({
              name: 'VIX Level',
              score: round(scoreVixLevel(vix)),
              weight: 2,
              detail: `VIX at ${round(vix)} — ${vix < 16 ? 'low fear' : vix < 22 ? 'moderate' : 'high fear'}`,
            })
          }
        } catch { /* skip */ }

        // 2. VIX term structure (weight: 1.5)
        try {
          const [vix9dCloses, vixCloses, vix3mCloses] = await Promise.all([
            fetchCloses(equityClient, '^VIX9D', 5),
            fetchCloses(equityClient, '^VIX', 5),
            fetchCloses(equityClient, '^VIX3M', 5),
          ])
          const vix9d = vix9dCloses[vix9dCloses.length - 1]
          const vix = vixCloses[vixCloses.length - 1]
          const vix3m = vix3mCloses[vix3mCloses.length - 1]
          if (vix9d && vix && vix3m) {
            const score = scoreTermStructure(vix9d, vix, vix3m)
            const shape = vix9d < vix && vix < vix3m ? 'contango' : vix9d > vix ? 'backwardation' : 'mixed'
            addFactor({
              name: 'VIX Term Structure',
              score: round(score),
              weight: 1.5,
              detail: `${shape} — 9D:${round(vix9d)} / Spot:${round(vix)} / 3M:${round(vix3m)}`,
            })
          }
        } catch { /* skip */ }

        // 3. Market momentum — SPY vs 125-day MA (weight: 1.5)
        try {
          const spyCloses = await fetchCloses(equityClient, 'SPY', 180)
          if (spyCloses.length >= 125) {
            const current = spyCloses[spyCloses.length - 1]
            const ma = sma(spyCloses, 125)!
            const pct = round(((current - ma) / ma) * 100)
            addFactor({
              name: 'Market Momentum',
              score: round(scoreMomentum(current, ma)),
              weight: 1.5,
              detail: `SPY ${pct >= 0 ? '+' : ''}${pct}% from 125-day MA`,
            })
          }
        } catch { /* skip */ }

        // 4. Market breadth — sector ETFs above 50-day MA (weight: 1)
        try {
          const breadthResults = await Promise.all(
            SECTOR_ETFS.map(async (etf) => {
              try {
                const closes = await fetchCloses(equityClient, etf, 70)
                if (closes.length < 50) return null
                const current = closes[closes.length - 1]
                const ma50 = sma(closes, 50)
                return ma50 != null ? current > ma50 : null
              } catch { return null }
            }),
          )
          const valid = breadthResults.filter(r => r != null)
          const above = valid.filter(r => r === true).length
          if (valid.length > 0) {
            addFactor({
              name: 'Market Breadth',
              score: round(scoreBreadth(above, valid.length)),
              weight: 1,
              detail: `${above}/${valid.length} sectors above 50-day MA`,
            })
          }
        } catch { /* skip */ }

        // 5. Safe haven demand — SPY vs TLT 20-day return (weight: 1)
        try {
          const [spyCloses, tltCloses] = await Promise.all([
            fetchCloses(equityClient, 'SPY', 30),
            fetchCloses(equityClient, 'TLT', 30),
          ])
          if (spyCloses.length >= 20 && tltCloses.length >= 20) {
            const spy20 = lastN(spyCloses, 21)
            const tlt20 = lastN(tltCloses, 21)
            const spyRet = ((spy20[spy20.length - 1] - spy20[0]) / spy20[0]) * 100
            const tltRet = ((tlt20[tlt20.length - 1] - tlt20[0]) / tlt20[0]) * 100
            addFactor({
              name: 'Safe Haven Demand',
              score: round(scoreSafeHaven(spyRet, tltRet)),
              weight: 1,
              detail: `SPY 20d: ${round(spyRet)}%, TLT 20d: ${round(tltRet)}% — ${tltRet > spyRet ? 'flight to safety' : 'risk-on'}`,
            })
          }
        } catch { /* skip */ }

        // 6. Junk bond demand — HYG vs LQD 20-day return (weight: 1)
        try {
          const [hygCloses, lqdCloses] = await Promise.all([
            fetchCloses(equityClient, 'HYG', 30),
            fetchCloses(equityClient, 'LQD', 30),
          ])
          if (hygCloses.length >= 20 && lqdCloses.length >= 20) {
            const hyg20 = lastN(hygCloses, 21)
            const lqd20 = lastN(lqdCloses, 21)
            const hygRet = ((hyg20[hyg20.length - 1] - hyg20[0]) / hyg20[0]) * 100
            const lqdRet = ((lqd20[lqd20.length - 1] - lqd20[0]) / lqd20[0]) * 100
            addFactor({
              name: 'Junk Bond Demand',
              score: round(scoreJunkBondDemand(hygRet, lqdRet)),
              weight: 1,
              detail: `HYG 20d: ${round(hygRet)}%, LQD 20d: ${round(lqdRet)}% — ${hygRet > lqdRet ? 'risk appetite' : 'credit caution'}`,
            })
          }
        } catch { /* skip */ }

        if (factors.length === 0) {
          return { error: 'Could not compute any fear/greed factors — market data unavailable.' }
        }

        const composite = round(weightedSum / totalWeight)
        const label = classifyScore(composite)

        return {
          score: composite,
          label,
          factorsUsed: factors.length,
          factors: factors.map(f => ({
            name: f.name,
            score: f.score,
            detail: f.detail,
          })),
          interpretation: label === 'EXTREME_FEAR'
            ? 'Markets are in extreme fear — historically a contrarian buy signal, but confirm with fundamentals'
            : label === 'FEAR'
              ? 'Fear is elevated — caution warranted, but opportunities may be forming'
              : label === 'NEUTRAL'
                ? 'Balanced sentiment — no strong directional signal from sentiment alone'
                : label === 'GREED'
                  ? 'Greed is elevated — consider tightening stops and reducing position sizes'
                  : 'Extreme greed — historically a warning signal. High risk of sharp reversal.',
        }
      },
    }),
  }
}
