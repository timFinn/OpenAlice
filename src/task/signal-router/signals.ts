/**
 * Signal Definitions
 *
 * Each signal monitors a specific market condition and fires when
 * a meaningful change is detected. Signals are stateless functions —
 * the router manages previous-state comparison.
 */

import type { EquityClientLike } from '@/domain/market-data/client/types.js'
import type { INewsProvider, NewsItem } from '@/domain/news/types.js'
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

// ==================== News Spike Signal ====================

/**
 * Monitors article volume across all RSS feeds. Fires when the last 30 minutes
 * of articles significantly exceeds the rolling 6-hour average rate.
 */
export function createNewsSpikeSignal(newsProvider: INewsProvider): SignalDefinition {
  return {
    id: 'news-spike',
    name: 'News Volume Spike',
    fetch: async () => {
      const now = new Date()
      const windowMs = 30 * 60 * 1000 // 30 minutes
      const baselineMs = 6 * 60 * 60 * 1000 // 6 hours

      const recentArticles = await newsProvider.getNewsV2({
        endTime: now,
        lookback: '30m',
      })
      const baselineArticles = await newsProvider.getNewsV2({
        endTime: now,
        lookback: '6h',
      })

      const recentCount = recentArticles.length
      // Average articles per 30-min window over the 6h baseline
      const baselineWindows = baselineMs / windowMs // 12
      const baselineRate = baselineArticles.length / baselineWindows
      const ratio = baselineRate > 0 ? recentCount / baselineRate : 0

      return {
        timestamp: Date.now(),
        values: { recentCount, baselineRate: parseFloat(baselineRate.toFixed(1)), ratio: parseFloat(ratio.toFixed(2)) },
      }
    },
    detect: (current, previous) => {
      const ratio = current.values.ratio as number
      const prevRatio = previous?.values.ratio as number | undefined
      const recentCount = current.values.recentCount as number

      // Need a minimum article count to avoid false positives from low-volume periods
      if (recentCount < 5) return null

      const wasSpike = prevRatio != null && prevRatio >= 2
      const isSpike = ratio >= 2

      if (!isSpike && !wasSpike) return null
      if (isSpike === wasSpike) return null // No transition

      if (isSpike) {
        return {
          signalId: 'news-spike',
          signalName: 'News Volume Spike',
          severity: ratio >= 3 ? 'critical' : 'warning',
          summary: `News volume at ${ratio.toFixed(1)}x normal rate (${recentCount} articles in 30min vs ${(current.values.baselineRate as number).toFixed(1)} avg)`,
          details: current.values,
        }
      }
      // Spike subsided
      return {
        signalId: 'news-spike',
        signalName: 'News Volume Spike Subsided',
        severity: 'info',
        summary: `News volume returned to normal (${ratio.toFixed(1)}x baseline)`,
        details: current.values,
      }
    },
  }
}

// ==================== Prediction Market Shift Signal ====================

const POLYMARKET_BASE = 'https://gamma-api.polymarket.com'
const POLYMARKET_TIMEOUT = 10_000

/**
 * Monitors top Polymarket events by volume. Fires when any event's
 * probability shifts >10 percentage points between polls.
 */
export function createPredictionShiftSignal(): SignalDefinition {
  return {
    id: 'prediction-shift',
    name: 'Prediction Market Shift',
    fetch: async () => {
      try {
        const res = await fetch(
          `${POLYMARKET_BASE}/events?limit=10&active=true&closed=false&order=volume24hr&ascending=false`,
          { signal: AbortSignal.timeout(POLYMARKET_TIMEOUT), headers: { Accept: 'application/json' } },
        )
        if (!res.ok) return { timestamp: Date.now(), values: { events: [], error: `HTTP ${res.status}` } }

        const events = (await res.json()) as Array<{
          id: string; title: string; volume24hr: number
          markets: Array<{ question: string; outcomePrices: string }>
        }>

        const parsed = events.slice(0, 10).map(e => {
          const market = e.markets?.[0]
          let probability: number | null = null
          try {
            const prices = JSON.parse(market?.outcomePrices ?? '[]') as number[]
            probability = prices[0] != null ? Math.round(prices[0] * 1000) / 10 : null
          } catch { /* */ }
          return { id: e.id, title: e.title, probability, volume24h: e.volume24hr ?? 0 }
        }).filter(e => e.probability != null)

        return { timestamp: Date.now(), values: { events: parsed } }
      } catch (err) {
        return { timestamp: Date.now(), values: { events: [], error: err instanceof Error ? err.message : String(err) } }
      }
    },
    detect: (current, previous) => {
      if (!previous) return null
      const currEvents = current.values.events as Array<{ id: string; title: string; probability: number; volume24h: number }>
      const prevEvents = previous.values.events as Array<{ id: string; title: string; probability: number }>
      if (!currEvents?.length || !prevEvents?.length) return null

      const prevMap = new Map(prevEvents.map(e => [e.id, e.probability]))

      const shifts: Array<{ title: string; from: number; to: number; delta: number }> = []
      for (const event of currEvents) {
        const prev = prevMap.get(event.id)
        if (prev == null) continue
        const delta = event.probability - prev
        if (Math.abs(delta) >= 10) {
          shifts.push({ title: event.title, from: prev, to: event.probability, delta })
        }
      }

      if (shifts.length === 0) return null

      const maxShift = shifts.reduce((a, b) => Math.abs(a.delta) >= Math.abs(b.delta) ? a : b)
      return {
        signalId: 'prediction-shift',
        signalName: 'Prediction Market Shift',
        severity: Math.abs(maxShift.delta) >= 20 ? 'critical' : 'warning',
        summary: shifts.map(s => `"${s.title}" ${s.from.toFixed(1)}% → ${s.to.toFixed(1)}% (${s.delta > 0 ? '+' : ''}${s.delta.toFixed(1)}pp)`).join('; '),
        details: { shifts, eventCount: currEvents.length },
      }
    },
  }
}

// ==================== News Sentiment Signal ====================

/** Lightweight bullish/bearish pattern matching — mirrors tool/news-sentiment.ts */
const BULL_PATTERNS = [
  /\bbeat(?:s|ing)?\s+(?:expectations?|estimates?|consensus)\b/i,
  /\bupgrad(?:e[ds]?|ing)\b/i,
  /\bstrong(?:er)?\s+(?:earnings?|results?|revenue|growth|demand)\b/i,
  /\brecord\s+(?:high|revenue|profit|earnings)\b/i,
  /\brais(?:e[ds]?|ing)\s+(?:guidance|outlook|forecast|dividend|target)\b/i,
  /\bsurg(?:e[ds]?|ing)\b/i, /\brall(?:y|ied|ying|ies)\b/i,
  /\bbullish\b/i, /\boptimis(?:m|tic)\b/i, /\bsoar(?:s|ed|ing)?\b/i,
]

const BEAR_PATTERNS = [
  /\bmiss(?:ed|es|ing)?\s+(?:expectations?|estimates?|consensus)\b/i,
  /\bdowngrad(?:e[ds]?|ing)\b/i,
  /\bweak(?:er|ness)?\s+(?:earnings?|results?|revenue|growth|demand)\b/i,
  /\blower(?:ed|ing|s)?\s+(?:guidance|outlook|forecast|target)\b/i,
  /\bplunge[ds]?\b/i, /\bcrash(?:ed|es|ing)?\b/i, /\bselloff\b|\bsell[\s-]off\b/i,
  /\bbearish\b/i, /\brecession\b/i, /\btumble[ds]?\b/i, /\bfraud\b/i,
]

function quickSentiment(articles: NewsItem[]): { score: number; bullish: number; bearish: number; total: number } {
  let bullish = 0
  let bearish = 0
  for (const article of articles) {
    const text = `${article.title} ${article.content}`
    let b = 0, br = 0
    for (const p of BULL_PATTERNS) if (p.test(text)) b++
    for (const p of BEAR_PATTERNS) if (p.test(text)) br++
    if (b > br) bullish++
    else if (br > b) bearish++
  }
  const total = bullish + bearish
  const score = total === 0 ? 0 : (bullish - bearish) / total
  return { score: parseFloat(score.toFixed(3)), bullish, bearish, total }
}

/**
 * Runs keyword sentiment on recent articles. Fires when aggregate
 * sentiment crosses into strong bullish/bearish territory.
 */
export function createNewsSentimentSignal(newsProvider: INewsProvider): SignalDefinition {
  return {
    id: 'news-sentiment',
    name: 'News Sentiment Extreme',
    fetch: async () => {
      const articles = await newsProvider.getNewsV2({
        endTime: new Date(),
        lookback: '1h',
      })
      const sentiment = quickSentiment(articles)
      const zone = sentiment.score >= 0.5 ? 'STRONG_BULLISH'
        : sentiment.score >= 0.2 ? 'BULLISH'
          : sentiment.score <= -0.5 ? 'STRONG_BEARISH'
            : sentiment.score <= -0.2 ? 'BEARISH'
              : 'NEUTRAL'
      return {
        timestamp: Date.now(),
        values: { ...sentiment, zone, articleCount: articles.length },
      }
    },
    detect: (current, previous) => {
      const zone = current.values.zone as string
      const prevZone = previous?.values.zone as string | undefined
      const articleCount = current.values.articleCount as number

      if (zone === prevZone) return null
      // Need enough articles for signal to be meaningful
      if (articleCount < 10) return null

      const isStrong = zone === 'STRONG_BULLISH' || zone === 'STRONG_BEARISH'
      const wasStrong = prevZone === 'STRONG_BULLISH' || prevZone === 'STRONG_BEARISH'
      // Only fire on transitions to/from strong zones
      if (!isStrong && !wasStrong) return null

      const score = current.values.score as number
      return {
        signalId: 'news-sentiment',
        signalName: 'News Sentiment Extreme',
        severity: isStrong ? 'critical' : 'info',
        summary: `News sentiment shifted from ${prevZone ?? 'unknown'} to ${zone} (score: ${score.toFixed(2)}, ${articleCount} articles)`,
        details: current.values,
      }
    },
  }
}

// ==================== Earnings Proximity Signal ====================

/**
 * Checks whether any symbol in a watched list has earnings within 2 trading days.
 * Uses the FMP earnings calendar via equityClient. Gracefully returns empty if
 * FMP is not configured.
 */
export function createEarningsProximitySignal(
  equityClient: EquityClientLike,
  watchSymbols: () => string[] | Promise<string[]>,
): SignalDefinition {
  return {
    id: 'earnings-proximity',
    name: 'Earnings Proximity Alert',
    fetch: async () => {
      const symbols = await watchSymbols()
      if (symbols.length === 0) {
        return { timestamp: Date.now(), values: { upcoming: [], symbols: [] } }
      }

      const today = new Date()
      const ahead = new Date(today)
      ahead.setDate(ahead.getDate() + 4) // ~2 trading days with weekend buffer

      const upcoming: Array<{ symbol: string; date: string }> = []

      try {
        const results = await equityClient.getCalendarEarnings({
          start_date: today.toISOString().slice(0, 10),
          end_date: ahead.toISOString().slice(0, 10),
          provider: 'fmp',
        })

        const symbolSet = new Set(symbols.map(s => s.toUpperCase()))
        for (const r of results) {
          const sym = (r.symbol as string ?? '').toUpperCase()
          if (symbolSet.has(sym)) {
            upcoming.push({ symbol: sym, date: (r.date as string) ?? (r.report_date as string) ?? '' })
          }
        }
      } catch (err) {
        // FMP key not set or API error — degrade gracefully
        return { timestamp: Date.now(), values: { upcoming: [], symbols, error: err instanceof Error ? err.message : String(err) } }
      }

      return { timestamp: Date.now(), values: { upcoming, symbols } }
    },
    detect: (current, previous) => {
      const upcoming = current.values.upcoming as Array<{ symbol: string; date: string }>
      const prevUpcoming = previous?.values.upcoming as Array<{ symbol: string; date: string }> | undefined

      if (!upcoming?.length) return null

      // Only fire when new symbols appear in the earnings window
      const prevSymbols = new Set((prevUpcoming ?? []).map(u => u.symbol))
      const newAlerts = upcoming.filter(u => !prevSymbols.has(u.symbol))
      if (newAlerts.length === 0) return null

      return {
        signalId: 'earnings-proximity',
        signalName: 'Earnings Proximity Alert',
        severity: 'warning',
        summary: newAlerts.map(a => `${a.symbol} earnings on ${a.date}`).join(', '),
        details: { upcoming, newAlerts },
      }
    },
  }
}

// ==================== Factory ====================

export interface SignalDeps {
  equityClient: EquityClientLike
  newsProvider?: INewsProvider
  /** Returns symbols the agent currently holds — used by earnings proximity signal */
  watchSymbols?: () => string[] | Promise<string[]>
}

export function createAllSignals(deps: SignalDeps): SignalDefinition[] {
  const { equityClient, newsProvider, watchSymbols } = deps
  const signals: SignalDefinition[] = [
    createVixRegimeSignal(equityClient),
    createVixTermStructureSignal(equityClient),
    createMomentumSignal(equityClient),
    createFearGreedExtremeSignal(equityClient),
    createPredictionShiftSignal(),
  ]

  if (newsProvider) {
    signals.push(createNewsSpikeSignal(newsProvider))
    signals.push(createNewsSentimentSignal(newsProvider))
  }

  if (watchSymbols) {
    signals.push(createEarningsProximitySignal(equityClient, watchSymbols))
  }

  return signals
}
