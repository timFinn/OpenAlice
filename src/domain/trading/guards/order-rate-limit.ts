/**
 * Order Rate Limit Guard
 *
 * Global rate limiter across all symbols. Uses a sliding window:
 * blocks if more than N orders have been placed in the last M minutes.
 * This is the primary defense against AI looping — prevents the agent
 * from placing thousands of trades per day.
 */

import type { OperationGuard, GuardContext } from './types.js'

const DEFAULT_MAX_ORDERS = 5
const DEFAULT_WINDOW_MINUTES = 60

export class OrderRateLimitGuard implements OperationGuard {
  readonly name = 'order-rate-limit'
  private maxOrders: number
  private windowMs: number
  private orderTimestamps: number[] = []

  constructor(options: Record<string, unknown>) {
    this.maxOrders = Number(options.maxOrders ?? DEFAULT_MAX_ORDERS)
    this.windowMs = Number(options.windowMinutes ?? DEFAULT_WINDOW_MINUTES) * 60_000
  }

  check(ctx: GuardContext): string | null {
    if (ctx.operation.action !== 'placeOrder') return null

    const now = Date.now()

    // Evict timestamps outside the window
    this.orderTimestamps = this.orderTimestamps.filter(t => now - t < this.windowMs)

    if (this.orderTimestamps.length >= this.maxOrders) {
      const oldestInWindow = this.orderTimestamps[0]
      const resetInSeconds = Math.ceil((this.windowMs - (now - oldestInWindow)) / 1000)
      const windowMinutes = this.windowMs / 60_000
      return `Order rate limit: ${this.orderTimestamps.length}/${this.maxOrders} orders in the last ${windowMinutes}m. Next slot in ${resetInSeconds}s.`
    }

    // Record this order
    this.orderTimestamps.push(now)
    return null
  }
}
