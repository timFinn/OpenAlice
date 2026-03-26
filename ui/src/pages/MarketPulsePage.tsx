import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import type { PulseData, SignalEvent, PredictionMarket, GDELTArticle, EconomyIndicator } from '../api/dashboard'
import { PageHeader } from '../components/PageHeader'
import { FearGreedGauge } from '../components/FearGreedGauge'
import { SignalFeed } from '../components/SignalFeed'

export function MarketPulsePage() {
  const [pulse, setPulse] = useState<PulseData | null>(null)
  const [signals, setSignals] = useState<SignalEvent[]>([])
  const [predictionMarkets, setPredictionMarkets] = useState<PredictionMarket[]>([])
  const [gdeltArticles, setGdeltArticles] = useState<GDELTArticle[]>([])
  const [gdeltTopic, setGdeltTopic] = useState('financial')
  const [economyIndicators, setEconomyIndicators] = useState<EconomyIndicator[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [pulseData, signalData, pmData, gdeltData, econData] = await Promise.all([
      api.dashboard.pulse().catch(() => null),
      api.dashboard.signals().catch(() => ({ events: [] })),
      api.dashboard.predictionMarkets().catch(() => ({ markets: [] })),
      api.dashboard.gdelt(gdeltTopic).catch(() => ({ topic: gdeltTopic, articles: [] })),
      api.dashboard.economyStrip().catch(() => ({ indicators: [] })),
    ])
    if (pulseData) setPulse(pulseData)
    setSignals(signalData.events)
    setPredictionMarkets(pmData.markets)
    setGdeltArticles(gdeltData.articles)
    setEconomyIndicators(econData.indicators)
    setLastRefresh(new Date())
    setLoading(false)
  }, [gdeltTopic])

  useEffect(() => { refresh() }, [refresh])

  // Refetch GDELT when topic changes
  useEffect(() => {
    api.dashboard.gdelt(gdeltTopic).then(d => setGdeltArticles(d.articles)).catch(() => {})
  }, [gdeltTopic])

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(refresh, 60_000)
    return () => clearInterval(interval)
  }, [refresh])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Market Pulse"
        description={<>Real-time market conditions and signal activity.{lastRefresh && <span className="ml-2 text-text-muted/50">Updated {lastRefresh.toLocaleTimeString()}</span>}</>}
        right={
          <button
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1.5 text-[13px] font-medium rounded-md border border-border hover:bg-bg-tertiary disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[900px] space-y-5">

          {/* Top Row: Fear/Greed + VIX */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Fear & Greed Gauge */}
            <div className="border border-border rounded-lg bg-bg-secondary p-5">
              <p className="text-[11px] text-text-muted uppercase tracking-wide mb-3">Fear & Greed</p>
              <FearGreedGauge
                score={pulse?.fearGreed?.score ?? null}
                label={pulse?.fearGreed?.label ?? null}
              />
            </div>

            {/* VIX Card */}
            <div className="border border-border rounded-lg bg-bg-secondary p-5">
              <p className="text-[11px] text-text-muted uppercase tracking-wide mb-3">Volatility</p>
              <div className="space-y-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-[28px] font-bold tabular-nums text-text">
                    {pulse?.vix?.toFixed(1) ?? '--'}
                  </span>
                  {pulse?.regime && (
                    <span className={`text-[12px] font-semibold uppercase ${regimeColor(pulse.regime)}`}>
                      {pulse.regime.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                {pulse?.termStructure && (
                  <div>
                    <p className="text-[11px] text-text-muted mb-1">Term Structure</p>
                    <div className="flex items-center gap-2">
                      <TermBar label="9D" value={pulse.termStructure.vix9d} />
                      <TermBar label="VIX" value={pulse.termStructure.vix} highlight />
                      <TermBar label="3M" value={pulse.termStructure.vix3m} />
                      <span className={`text-[11px] font-semibold ml-2 ${
                        pulse.termStructure.shape === 'BACKWARDATION' ? 'text-red' :
                        pulse.termStructure.shape === 'CONTANGO' ? 'text-green' : 'text-text-muted'
                      }`}>
                        {pulse.termStructure.shape}
                      </span>
                    </div>
                  </div>
                )}

                {pulse?.skew != null && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-muted">SKEW</span>
                    <span className="text-[13px] font-medium tabular-nums text-text">{pulse.skew}</span>
                    <span className={`text-[10px] ${pulse.skew > 140 ? 'text-red' : pulse.skew > 130 ? 'text-yellow-400' : 'text-text-muted'}`}>
                      {pulse.skew > 140 ? 'elevated tail risk' : pulse.skew > 130 ? 'above normal' : 'normal'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Economy Indicators Strip */}
          {economyIndicators.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {economyIndicators.map(ind => (
                <div key={ind.label} className="border border-border rounded-lg bg-bg-secondary px-4 py-2.5 min-w-[120px]">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide">{ind.label}</p>
                  <p className="text-[18px] font-bold tabular-nums text-text">{ind.value ?? '--'}</p>
                </div>
              ))}
            </div>
          )}

          {/* Signal Activity Feed */}
          <div className="border border-border rounded-lg bg-bg-secondary p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide">
                Signal Activity
              </h3>
              {pulse?.signalCount != null && (
                <span className="text-[11px] text-text-muted">{pulse.signalCount} recent</span>
              )}
            </div>
            <SignalFeed events={signals} />
          </div>

          {/* Prediction Markets */}
          {predictionMarkets.length > 0 && (
            <div className="border border-border rounded-lg bg-bg-secondary p-4">
              <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
                Prediction Markets
              </h3>
              <div className="space-y-2">
                {predictionMarkets.map((pm, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-text truncate">{pm.question}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2 w-[180px]">
                      <div className="flex-1 h-2 rounded-full bg-bg-tertiary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent transition-all"
                          style={{ width: `${pm.probability ?? 0}%` }}
                        />
                      </div>
                      <span className="text-[13px] font-medium tabular-nums text-text w-[40px] text-right">
                        {pm.probability != null ? `${pm.probability}%` : '--'}
                      </span>
                    </div>
                    <span className="text-[10px] text-text-muted shrink-0">
                      ${pm.volume24h > 1_000_000 ? `${(pm.volume24h / 1_000_000).toFixed(1)}M` : `${(pm.volume24h / 1000).toFixed(0)}K`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* GDELT News Feed */}
          <div className="border border-border rounded-lg bg-bg-secondary p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide">
                Global News Intelligence
              </h3>
              <div className="flex gap-1">
                {(['financial', 'geopolitical', 'energy'] as const).map(topic => (
                  <button
                    key={topic}
                    onClick={() => { setGdeltTopic(topic); }}
                    className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                      gdeltTopic === topic
                        ? 'bg-accent/20 text-accent font-medium'
                        : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
                    }`}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
            {gdeltArticles.length === 0 ? (
              <p className="text-[13px] text-text-muted text-center py-4">No articles in the last 24 hours.</p>
            ) : (
              <div className="space-y-1.5">
                {gdeltArticles.map((article, i) => (
                  <a
                    key={i}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-tertiary/30 transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-text group-hover:text-accent transition-colors truncate">
                        {article.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-text-muted">{article.source}</span>
                        {article.country && (
                          <span className="text-[10px] text-text-muted/50">{article.country}</span>
                        )}
                        <span className="text-[10px] text-text-muted/50">
                          {article.time ? new Date(article.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

// ==================== Helpers ====================

function regimeColor(regime: string): string {
  switch (regime) {
    case 'EXTREME_COMPLACENCY': return 'text-yellow-400'
    case 'LOW': return 'text-green'
    case 'NORMAL': return 'text-text-muted'
    case 'ELEVATED': return 'text-yellow-400'
    case 'HIGH': return 'text-red/70'
    case 'VERY_HIGH': return 'text-red'
    default: return 'text-text-muted'
  }
}

function TermBar({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`text-[13px] font-medium tabular-nums ${highlight ? 'text-text' : 'text-text-muted'}`}>
        {value.toFixed(1)}
      </span>
      <span className="text-[9px] text-text-muted/50 uppercase">{label}</span>
    </div>
  )
}
