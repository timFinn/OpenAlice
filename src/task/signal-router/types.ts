/**
 * Signal Router Types
 *
 * Defines the signal detection framework: what conditions to monitor,
 * how to detect changes, and how to route them to the agent.
 */

export interface SignalDefinition {
  /** Unique signal identifier. */
  id: string
  /** Human-readable name. */
  name: string
  /** How to fetch the current value. */
  fetch: () => Promise<SignalSnapshot>
  /** Detect if a meaningful change occurred. Returns null if no signal. */
  detect: (current: SignalSnapshot, previous: SignalSnapshot | null) => SignalEvent | null
}

export interface SignalSnapshot {
  timestamp: number
  values: Record<string, unknown>
}

export interface SignalEvent {
  signalId: string
  signalName: string
  severity: 'info' | 'warning' | 'critical'
  summary: string
  details: Record<string, unknown>
}

export interface SignalRouterConfig {
  enabled: boolean
  /** Poll interval, e.g. "2m", "5m". */
  pollInterval: string
  /** Target account for autonomous trading signals. */
  targetAccount: string
  /** Active hours — null means always active. */
  activeHours: {
    start: string
    end: string
    timezone: string
  } | null
}

export const DEFAULT_SIGNAL_ROUTER_CONFIG: SignalRouterConfig = {
  enabled: false,
  pollInterval: '2m',
  targetAccount: 'alpaca-paper-auto',
  activeHours: {
    start: '09:00',
    end: '16:30',
    timezone: 'America/New_York',
  },
}
