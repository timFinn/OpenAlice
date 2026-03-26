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

  return app
}
