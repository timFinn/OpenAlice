import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import type { PulseData, SignalEvent } from '../api/dashboard'
import { PageHeader } from '../components/PageHeader'
import { FearGreedGauge } from '../components/FearGreedGauge'
import { SignalFeed } from '../components/SignalFeed'

export function MarketPulsePage() {
  const [pulse, setPulse] = useState<PulseData | null>(null)
  const [signals, setSignals] = useState<SignalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [pulseData, signalData] = await Promise.all([
      api.dashboard.pulse().catch(() => null),
      api.dashboard.signals().catch(() => ({ events: [] })),
    ])
    if (pulseData) setPulse(pulseData)
    setSignals(signalData.events)
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

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
