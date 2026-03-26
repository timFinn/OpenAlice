/**
 * Signal Router — monitors market conditions and triggers the agent
 * when meaningful changes are detected.
 *
 * Architecture:
 *   1. Registers a __signal_scan__ cron job that fires on pollInterval
 *   2. On fire: runs all signal definitions (fetch + detect)
 *   3. If any signal fires: prompts the agent with context about what changed
 *   4. Agent decides whether to trade on the target (paper-auto) account
 *
 * Follows the same pattern as heartbeat: cron engine → event log → agent.
 */

import type { EventLog, EventLogEntry } from '../../core/event-log.js'
import type { AgentCenter } from '../../core/agent-center.js'
import { SessionStore } from '../../core/session.js'
import type { ConnectorCenter } from '../../core/connector-center.js'
import type { CronEngine, CronFirePayload } from '../cron/engine.js'
import { isWithinActiveHours } from '../heartbeat/heartbeat.js'
import type { SignalDefinition, SignalSnapshot, SignalEvent, SignalRouterConfig } from './types.js'

// ==================== Constants ====================

export const SIGNAL_SCAN_JOB_NAME = '__signal_scan__'

// ==================== Factory ====================

export interface SignalRouterOpts {
  config: SignalRouterConfig
  signals: SignalDefinition[]
  connectorCenter: ConnectorCenter
  cronEngine: CronEngine
  eventLog: EventLog
  agentCenter: AgentCenter
  session?: SessionStore
}

export interface SignalRouter {
  start(): Promise<void>
  stop(): void
}

export function createSignalRouter(opts: SignalRouterOpts): SignalRouter {
  const { config, signals, connectorCenter, cronEngine, eventLog, agentCenter } = opts
  const session = opts.session ?? new SessionStore('signal-router')

  let unsubscribe: (() => void) | null = null
  let jobId: string | null = null
  let processing = false

  // Previous snapshots per signal — used for change detection
  const previousSnapshots = new Map<string, SignalSnapshot>()

  async function handleFire(entry: EventLogEntry): Promise<void> {
    const payload = entry.payload as CronFirePayload
    if (payload.jobName !== SIGNAL_SCAN_JOB_NAME) return
    if (processing) return

    processing = true
    const startMs = Date.now()

    try {
      // Active hours check
      if (!isWithinActiveHours(config.activeHours)) {
        return
      }

      // Run all signal checks in parallel
      const firedSignals: SignalEvent[] = []

      await Promise.all(signals.map(async (signal) => {
        try {
          const snapshot = await signal.fetch()
          const previous = previousSnapshots.get(signal.id) ?? null
          const event = signal.detect(snapshot, previous)
          previousSnapshots.set(signal.id, snapshot)

          if (event) {
            firedSignals.push(event)
            await eventLog.append('signal.fire', event)
          }
        } catch (err) {
          console.warn(`signal-router: ${signal.id} fetch/detect failed:`, err instanceof Error ? err.message : err)
        }
      }))

      if (firedSignals.length === 0) return

      // Build prompt with signal context
      const prompt = buildSignalPrompt(firedSignals, config.targetAccount)

      console.log(`signal-router: ${firedSignals.length} signal(s) fired — ${firedSignals.map(s => s.signalId).join(', ')}`)

      // Route to agent
      const result = await agentCenter.askWithSession(prompt, session, {
        historyPreamble: 'The following is the signal router session. You are evaluating market signals for autonomous paper trading.',
      })

      // Notify user of significant signals
      const hasCritical = firedSignals.some(s => s.severity === 'critical')
      if (hasCritical) {
        try {
          await connectorCenter.notify(
            `**Signal Alert**: ${firedSignals.map(s => s.summary).join(' | ')}`,
            { source: 'signal-router' },
          )
        } catch { /* best effort */ }
      }

      await eventLog.append('signal.routed', {
        signals: firedSignals.map(s => s.signalId),
        reply: result.text.slice(0, 500),
        durationMs: Date.now() - startMs,
      })
    } catch (err) {
      console.error('signal-router: error:', err)
      await eventLog.append('signal.error', {
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs,
      })
    } finally {
      processing = false
    }
  }

  return {
    async start() {
      if (!config.enabled) return

      // Register or update the cron job
      const existing = cronEngine.list().find(j => j.name === SIGNAL_SCAN_JOB_NAME)
      if (existing) {
        jobId = existing.id
        await cronEngine.update(existing.id, {
          schedule: { kind: 'every', every: config.pollInterval },
          payload: 'signal scan',
          enabled: true,
        })
      } else {
        jobId = await cronEngine.add({
          name: SIGNAL_SCAN_JOB_NAME,
          schedule: { kind: 'every', every: config.pollInterval },
          payload: 'signal scan',
          enabled: true,
        })
      }

      // Subscribe to cron.fire events
      unsubscribe = eventLog.subscribeType('cron.fire', (entry) => {
        handleFire(entry).catch(err => {
          console.error('signal-router: unhandled error:', err)
        })
      })

      console.log(`signal-router: started (${signals.length} signals, poll every ${config.pollInterval})`)
    },

    stop() {
      unsubscribe?.()
      unsubscribe = null
    },
  }
}

// ==================== Prompt Builder ====================

function buildSignalPrompt(signals: SignalEvent[], targetAccount: string): string {
  const signalBlock = signals.map(s => {
    const severity = s.severity === 'critical' ? '🔴 CRITICAL' : s.severity === 'warning' ? '🟡 WARNING' : 'ℹ️ INFO'
    return `[${severity}] ${s.summary}\n${JSON.stringify(s.details, null, 2)}`
  }).join('\n\n')

  return `## Market Signal Alert

The following market condition change(s) were just detected:

${signalBlock}

## Your Task

You are the autonomous paper trading bot. Evaluate these signals and decide whether to act on account "${targetAccount}".

1. **Assess**: What do these signals mean for the current market environment?
2. **Check context**: Use volatilityDashboard, fearGreedIndex, getPortfolio, and tradingLog to understand the current state.
3. **Decide**: Should you open, close, or modify any positions? Or is this a signal to watch but not act on yet?
4. **Execute if warranted**: Stage → commit → push on the "${targetAccount}" account. Your commit message should reference the signal that triggered the trade.

If you decide NOT to trade, explain briefly why — this builds the decision log for strategy evaluation.

Remember: this is paper trading for theory testing. Be decisive — the point is to build a track record, not to be cautious.`
}
