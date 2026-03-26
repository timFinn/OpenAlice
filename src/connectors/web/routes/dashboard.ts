/**
 * Dashboard API Routes
 *
 * Serves pre-computed market pulse data and paper bot scorecard
 * for the frontend dashboard. Reads from event log, account manager,
 * and the embedded OpenBB API for VIX data.
 */

import { Hono } from 'hono'
import type { EngineContext } from '../../../core/types.js'

const OPENBB_BASE = 'http://localhost:6901'
const FETCH_TIMEOUT = 8_000

// ==================== Helpers ====================

async function fetchVixData(): Promise<{
  vix: number | null
  vix9d: number | null
  vix3m: number | null
  skew: number | null
}> {
  const results: Record<string, number | null> = { vix: null, vix9d: null, vix3m: null, skew: null }
  const symbols: Array<[string, string]> = [
    ['^VIX', 'vix'], ['^VIX9D', 'vix9d'], ['^VIX3M', 'vix3m'], ['^SKEW', 'skew'],
  ]

  await Promise.all(symbols.map(async ([symbol, key]) => {
    try {
      const d = new Date()
      d.setDate(d.getDate() - 5)
      const start = d.toISOString().slice(0, 10)
      const url = `${OPENBB_BASE}/api/v1/equity/price/historical?symbol=${encodeURIComponent(symbol)}&start_date=${start}&interval=1d&provider=yfinance`
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
      if (!res.ok) return
      const data = await res.json() as { results?: Array<{ close?: number }> }
      const bars = data.results?.filter(b => b.close != null) ?? []
      if (bars.length > 0) results[key] = bars[bars.length - 1].close!
    } catch { /* skip */ }
  }))

  return results as { vix: number | null; vix9d: number | null; vix3m: number | null; skew: number | null }
}

function classifyVixRegime(vix: number): string {
  if (vix >= 30) return 'VERY_HIGH'
  if (vix >= 25) return 'HIGH'
  if (vix >= 20) return 'ELEVATED'
  if (vix >= 16) return 'NORMAL'
  if (vix >= 12) return 'LOW'
  return 'EXTREME_COMPLACENCY'
}

function computeFearGreedFromVix(vix: number): { score: number; label: string } {
  const score = Math.max(0, Math.min(100, 115 - 3.6 * vix))
  const label = score >= 80 ? 'EXTREME_GREED'
    : score >= 60 ? 'GREED'
      : score >= 40 ? 'NEUTRAL'
        : score >= 20 ? 'FEAR'
          : 'EXTREME_FEAR'
  return { score: Math.round(score), label }
}

// ==================== Signal Tag Extraction (mirrors paper-attribution.ts) ====================

const SIGNAL_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'vix-regime', pattern: /vix.?regime|vix.*(?:high|elevated|complacency|extreme)/i },
  { tag: 'vix-backwardation', pattern: /backwardation|term.?structure.*inver/i },
  { tag: 'momentum-cross', pattern: /(?:50|125).?(?:day|d).*(?:ma|moving|cross)/i },
  { tag: 'fear-greed', pattern: /fear.*greed|extreme.*(?:fear|greed)|sentiment.*(?:extreme|shift)/i },
  { tag: 'technical', pattern: /oversold|overbought|rsi|support|resistance|breakout/i },
]

function extractSignalTags(message: string): string[] {
  const tags: string[] = []
  for (const { tag, pattern } of SIGNAL_PATTERNS) {
    if (pattern.test(message)) tags.push(tag)
  }
  return tags.length > 0 ? tags : ['untagged']
}

// ==================== Route Factory ====================

export function createDashboardRoutes(ctx: EngineContext) {
  const app = new Hono()

  // Market pulse: VIX, fear/greed, term structure
  app.get('/pulse', async (c) => {
    const vixData = await fetchVixData()
    const vix = vixData.vix

    const regime = vix != null ? classifyVixRegime(vix) : null
    const fearGreed = vix != null ? computeFearGreedFromVix(vix) : null

    let termStructure: { shape: string; vix9d: number; vix: number; vix3m: number } | null = null
    if (vixData.vix9d != null && vix != null && vixData.vix3m != null) {
      const shape = vixData.vix9d < vix && vix < vixData.vix3m
        ? 'CONTANGO'
        : vixData.vix9d > vix
          ? 'BACKWARDATION'
          : 'MIXED'
      termStructure = {
        shape,
        vix9d: Math.round(vixData.vix9d * 10) / 10,
        vix: Math.round(vix * 10) / 10,
        vix3m: Math.round(vixData.vix3m * 10) / 10,
      }
    }

    const skew = vixData.skew != null ? Math.round(vixData.skew * 10) / 10 : null

    // Recent signals from event log
    const signalEvents = ctx.eventLog.recent({ limit: 20, type: 'signal.fire' })

    return c.json({
      vix: vix != null ? Math.round(vix * 10) / 10 : null,
      regime,
      fearGreed,
      termStructure,
      skew,
      signalCount: signalEvents.length,
      lastSignal: signalEvents[0]?.payload ?? null,
    })
  })

  // Signal activity feed
  app.get('/signals', async (c) => {
    const limit = Number(c.req.query('limit')) || 30

    const fireEvents = ctx.eventLog.recent({ limit, type: 'signal.fire' })
    const routedEvents = ctx.eventLog.recent({ limit, type: 'signal.routed' })

    const signals = fireEvents.map(e => ({
      type: 'signal' as const,
      timestamp: new Date(e.ts).toISOString(),
      ...e.payload as Record<string, unknown>,
    }))

    const routed = routedEvents.map(e => ({
      type: 'routed' as const,
      timestamp: new Date(e.ts).toISOString(),
      ...e.payload as Record<string, unknown>,
    }))

    // Merge and sort by timestamp descending
    const all = [...signals, ...routed]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit)

    return c.json({ events: all })
  })

  // Paper bot scorecard
  app.get('/paper-scorecard', (c) => {
    const accountId = c.req.query('account') ?? 'alpaca-paper-auto'
    const targets = ctx.accountManager.resolve(accountId)
    if (targets.length === 0) return c.json({ error: `Account "${accountId}" not found.` }, 404)

    const uta = targets[0]
    const commits = uta.log({ limit: 200 })

    if (commits.length === 0) {
      return c.json({
        account: accountId,
        totalCommits: 0,
        overall: { winRate: 0, profitFactor: 0, totalTrades: 0, openPositions: 0 },
        bySignal: {},
        recentTrades: [],
      })
    }

    // Track trades
    const openTrades = new Map<string, { symbol: string; side: string; signalTags: string[]; entryTime: string; entryMessage: string }>()
    const completedTrades: Array<{ symbol: string; signalTags: string[]; entryTime: string; exitTime: string; holdingHours: number }>  = []
    const chronological = [...commits].reverse()

    for (const commit of chronological) {
      const signalTags = extractSignalTags(commit.message)
      for (const op of commit.operations) {
        if (op.symbol === 'unknown') continue
        if (op.action === 'placeOrder' && (op.status === 'submitted' || op.status === 'filled')) {
          if (!openTrades.has(op.symbol)) {
            openTrades.set(op.symbol, {
              symbol: op.symbol,
              side: op.change.startsWith('BUY') ? 'long' : 'short',
              signalTags,
              entryTime: commit.timestamp,
              entryMessage: commit.message,
            })
          }
        }
        if (op.action === 'closePosition' && (op.status === 'submitted' || op.status === 'filled')) {
          const trade = openTrades.get(op.symbol)
          if (trade) {
            const entryMs = new Date(trade.entryTime).getTime()
            const exitMs = new Date(commit.timestamp).getTime()
            completedTrades.push({
              symbol: trade.symbol,
              signalTags: trade.signalTags,
              entryTime: trade.entryTime,
              exitTime: commit.timestamp,
              holdingHours: (exitMs - entryMs) / (1000 * 60 * 60),
            })
            openTrades.delete(op.symbol)
          }
        }
      }
    }

    // By-signal counts
    const bySignal: Record<string, { trades: number }> = {}
    const allTrades = [...completedTrades.map(t => t.signalTags), ...Array.from(openTrades.values()).map(t => t.signalTags)]
    for (const tags of allTrades) {
      for (const tag of tags) {
        if (!bySignal[tag]) bySignal[tag] = { trades: 0 }
        bySignal[tag].trades++
      }
    }

    // Recent trades
    const allTradesList = [
      ...Array.from(openTrades.values()).map(t => ({ ...t, exitTime: null as string | null, status: 'open' })),
      ...completedTrades.map(t => ({ ...t, side: 'unknown', entryMessage: '', status: 'closed' })),
    ].sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())
      .slice(0, 10)

    return c.json({
      account: accountId,
      totalCommits: commits.length,
      overall: {
        totalTrades: completedTrades.length + openTrades.size,
        completedTrades: completedTrades.length,
        openPositions: openTrades.size,
      },
      bySignal,
      recentTrades: allTradesList.map(t => ({
        symbol: t.symbol,
        signalTags: t.signalTags,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        status: t.status,
      })),
    })
  })

  // Prediction market spotlight — top markets by 24h volume from Polymarket
  app.get('/prediction-markets', async (c) => {
    const limit = Number(c.req.query('limit')) || 5
    try {
      const params = new URLSearchParams({
        active: 'true',
        closed: 'false',
        order: 'volume24hr',
        ascending: 'false',
        limit: String(limit),
      })
      const res = await fetch(`https://gamma-api.polymarket.com/events?${params}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (!res.ok) return c.json({ markets: [], error: `Polymarket: ${res.status}` })

      const events = await res.json() as Array<{
        title: string
        slug: string
        volume24hr: number
        markets?: Array<{
          question: string
          outcomePrices: string
          outcomes: string
          volume24hr: number
        }>
      }>

      const markets = events.map(e => {
        const topMarket = e.markets?.[0]
        let probability: number | null = null
        let yesLabel = 'Yes'
        if (topMarket) {
          try {
            const prices = JSON.parse(topMarket.outcomePrices) as string[]
            const outcomes = JSON.parse(topMarket.outcomes) as string[]
            probability = Math.round(parseFloat(prices[0]) * 100)
            yesLabel = outcomes[0] ?? 'Yes'
          } catch { /* skip */ }
        }
        return {
          title: e.title,
          question: topMarket?.question ?? e.title,
          probability,
          yesLabel,
          volume24h: Math.round(e.volume24hr ?? 0),
        }
      })

      return c.json({ markets })
    } catch (err) {
      return c.json({ markets: [], error: err instanceof Error ? err.message : String(err) })
    }
  })

  // GDELT recent articles — from feeds.timfinn.dev Atom feeds (cached by pliny feed-server)
  app.get('/gdelt', async (c) => {
    const topic = c.req.query('topic') ?? 'financial'
    const limit = Number(c.req.query('limit')) || 10

    const TOPIC_SLUGS: Record<string, string> = {
      financial: 'financial-economic',
      geopolitical: 'geopolitics-foreign-policy',
      energy: 'defense-space-industry',
      cyber: 'cybersecurity-threat-intelligence',
    }

    const slug = TOPIC_SLUGS[topic] ?? TOPIC_SLUGS.financial

    try {
      const res = await fetch(`https://feeds.timfinn.dev/feed/${slug}.xml`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (!res.ok) return c.json({ topic, articles: [], error: `Feed server: ${res.status}` })

      const xml = await res.text()

      // Simple Atom XML parsing — extract <entry> elements
      const entries = xml.split('<entry>').slice(1)
      const articles = entries.slice(0, limit).map(entry => {
        const title = entry.match(/<title>(.*?)<\/title>/)?.[1] ?? ''
        const url = entry.match(/<link href="(.*?)"/)?.[1] ?? ''
        const source = entry.match(/<name>(.*?)<\/name>/)?.[1] ?? ''
        const time = entry.match(/<published>(.*?)<\/published>/)?.[1] ?? ''
        return { title, source, country: '', time, url }
      }).filter(a => a.title)

      return c.json({ topic, articles })
    } catch (err) {
      return c.json({ topic, articles: [], error: err instanceof Error ? err.message : String(err) })
    }
  })

  // Economy indicators — key FRED series via direct FRED API
  app.get('/economy-strip', async (c) => {
    const fredKey = ctx.config?.marketData?.providerKeys?.fred ?? ''

    const SERIES: Array<{ id: string; label: string; suffix?: string }> = [
      { id: 'DGS10', label: '10Y Yield', suffix: '%' },
      { id: 'DGS2', label: '2Y Yield', suffix: '%' },
      { id: 'FEDFUNDS', label: 'Fed Funds', suffix: '%' },
      { id: 'T10Y2Y', label: '10Y-2Y Spread', suffix: '%' },
    ]

    if (!fredKey) {
      return c.json({ indicators: SERIES.map(s => ({ label: s.label, value: null })) })
    }

    const results: Array<{ label: string; value: string | null }> = []

    await Promise.all(SERIES.map(async (s) => {
      try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}&api_key=${fredKey}&file_type=json&sort_order=desc&limit=1`
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
        if (!res.ok) { results.push({ label: s.label, value: null }); return }
        const data = await res.json() as { observations?: Array<{ value?: string }> }
        const latest = data.observations?.[0]
        const val = latest?.value != null && latest.value !== '.' ? parseFloat(latest.value) : null
        results.push({
          label: s.label,
          value: val != null ? `${val.toFixed(2)}${s.suffix ?? ''}` : null,
        })
      } catch {
        results.push({ label: s.label, value: null })
      }
    }))

    // Maintain order
    const ordered = SERIES.map(s => results.find(r => r.label === s.label) ?? { label: s.label, value: null })

    return c.json({ indicators: ordered })
  })

  return app
}
