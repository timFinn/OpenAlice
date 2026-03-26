/**
 * Signal Activity Feed — timeline of signal router events.
 */

import type { SignalEvent } from '../api/dashboard'

interface SignalFeedProps {
  events: SignalEvent[]
}

const SEVERITY_DOTS: Record<string, string> = {
  critical: 'bg-red',
  warning: 'bg-yellow-400',
  info: 'bg-accent',
}

export function SignalFeed({ events }: SignalFeedProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-6 text-text-muted text-[13px]">
        No signals yet. The signal router fires during market hours (09:00–16:30 ET).
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {events.map((event, i) => {
        const isSignal = event.type === 'signal'
        const severity = (event.severity as string) ?? 'info'
        const dotColor = SEVERITY_DOTS[severity] ?? 'bg-text-muted'
        const time = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

        if (isSignal) {
          return (
            <div key={i} className="flex items-start gap-2 px-3 py-1.5 rounded-md hover:bg-bg-tertiary/30 transition-colors">
              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-text-muted font-mono">{time}</span>
                  <span className="text-[11px] px-1 py-0.5 rounded bg-bg-tertiary text-text-muted">
                    {event.signalId}
                  </span>
                </div>
                <p className="text-[13px] text-text truncate">{event.summary}</p>
              </div>
            </div>
          )
        }

        // Routed event (agent response)
        const signals = (event.signals as string[]) ?? []
        const reply = typeof event.reply === 'string' ? event.reply.slice(0, 200) : ''

        return (
          <div key={i} className="flex items-start gap-2 px-3 py-1.5 rounded-md bg-bg-secondary/50">
            <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-accent/50" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-muted font-mono">{time}</span>
                <span className="text-[11px] px-1 py-0.5 rounded bg-accent/15 text-accent">
                  agent responded
                </span>
                {signals.map(s => (
                  <span key={s} className="text-[10px] text-text-muted">{s}</span>
                ))}
              </div>
              {reply && (
                <p className="text-[12px] text-text-muted mt-0.5 truncate">{reply}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
