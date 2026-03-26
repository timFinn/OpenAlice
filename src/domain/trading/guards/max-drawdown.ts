/**
 * Max Drawdown Guard
 *
 * Tracks high-water mark of account equity and blocks trading
 * when current equity drops below the HWM by more than X%.
 * HWM is updated on every check — ratchets up, never down.
 */

import type { OperationGuard, GuardContext } from './types.js'

const DEFAULT_MAX_DRAWDOWN_PERCENT = 10

export class MaxDrawdownGuard implements OperationGuard {
  readonly name = 'max-drawdown'
  private maxDrawdownPercent: number
  private highWaterMark: number = 0

  constructor(options: Record<string, unknown>) {
    this.maxDrawdownPercent = Number(options.maxDrawdownPercent ?? DEFAULT_MAX_DRAWDOWN_PERCENT)
  }

  check(ctx: GuardContext): string | null {
    if (ctx.operation.action !== 'placeOrder') return null

    const equity = ctx.account.netLiquidation

    // Update high-water mark
    if (equity > this.highWaterMark) {
      this.highWaterMark = equity
    }

    // No HWM established yet — allow
    if (this.highWaterMark <= 0) return null

    const drawdownPercent = ((this.highWaterMark - equity) / this.highWaterMark) * 100

    if (drawdownPercent >= this.maxDrawdownPercent) {
      return `Drawdown limit reached: ${drawdownPercent.toFixed(1)}% below high-water mark $${this.highWaterMark.toFixed(0)} (limit: ${this.maxDrawdownPercent}%). New positions blocked.`
    }

    return null
  }
}
