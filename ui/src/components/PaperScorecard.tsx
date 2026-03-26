/**
 * Paper Bot Scorecard — performance summary of the autonomous paper trading bot.
 */

import { useState, useEffect, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '../api'
import type { PaperScorecard as PaperScorecardData } from '../api/dashboard'

export function PaperScorecard() {
  const [data, setData] = useState<PaperScorecardData | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await api.dashboard.paperScorecard()
      setData(result)
    } catch {
      // skip
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return null

  if (!data || data.totalCommits === 0) {
    return (
      <div className="border border-border rounded-lg bg-bg-secondary p-4">
        <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-2">
          Paper Bot
        </h3>
        <p className="text-[13px] text-text-muted">
          No paper trades yet. The autonomous bot will start trading when signals fire during market hours.
        </p>
      </div>
    )
  }

  const { overall, bySignal, recentTrades } = data

  // Chart data for by-signal breakdown
  const chartData = Object.entries(bySignal)
    .map(([tag, { trades }]) => ({ tag, trades }))
    .sort((a, b) => b.trades - a.trades)

  return (
    <div className="border border-border rounded-lg bg-bg-secondary p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide">
          Paper Bot
        </h3>
        <span className="text-[11px] text-text-muted">{data.account}</span>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Trades" value={String(overall.totalTrades)} />
        <KPI label="Open" value={String(overall.openPositions)} />
        <KPI label="Completed" value={String(overall.completedTrades ?? 0)} />
        <KPI label="Commits" value={String(data.totalCommits)} />
      </div>

      {/* By-Signal Chart */}
      {chartData.length > 0 && (
        <div>
          <p className="text-[11px] text-text-muted uppercase tracking-wide mb-2">By Signal</p>
          <ResponsiveContainer width="100%" height={Math.max(80, chartData.length * 28)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="tag"
                width={120}
                tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="trades" fill="var(--color-accent)" radius={[0, 4, 4, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent Trades */}
      {recentTrades.length > 0 && (
        <div>
          <p className="text-[11px] text-text-muted uppercase tracking-wide mb-2">Recent Decisions</p>
          <div className="space-y-1">
            {recentTrades.slice(0, 5).map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <div className={`w-1.5 h-1.5 rounded-full ${t.status === 'open' ? 'bg-accent' : 'bg-green'}`} />
                <span className="text-text font-medium">{t.symbol}</span>
                {t.signalTags.map(tag => (
                  <span key={tag} className="text-[10px] px-1 py-0.5 rounded bg-bg-tertiary text-text-muted">{tag}</span>
                ))}
                <span className="text-text-muted ml-auto">{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-[20px] font-bold tabular-nums text-text">{value}</p>
    </div>
  )
}
