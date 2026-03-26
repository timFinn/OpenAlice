/**
 * Max Daily Loss Guard
 *
 * Kill switch: blocks ALL trading operations when the account has lost
 * more than X% of equity since the start of the trading day.
 * Resets when a new calendar day is detected.
 */

import type { OperationGuard, GuardContext } from './types.js'

const DEFAULT_MAX_DAILY_LOSS_PERCENT = 5

export class MaxDailyLossGuard implements OperationGuard {
  readonly name = 'max-daily-loss'
  private maxLossPercent: number
  private dayStartEquity: number | null = null
  private currentDay: string | null = null

  constructor(options: Record<string, unknown>) {
    this.maxLossPercent = Number(options.maxDailyLossPercent ?? DEFAULT_MAX_DAILY_LOSS_PERCENT)
  }

  check(ctx: GuardContext): string | null {
    // Only gate operations that open or modify positions
    if (ctx.operation.action !== 'placeOrder' && ctx.operation.action !== 'closePosition') return null

    const today = new Date().toISOString().slice(0, 10)
    const equity = ctx.account.netLiquidation

    // Reset on new day
    if (this.currentDay !== today) {
      this.currentDay = today
      this.dayStartEquity = equity
    }

    // First check of the day — record starting equity, allow
    if (this.dayStartEquity == null || this.dayStartEquity <= 0) {
      this.dayStartEquity = equity
      return null
    }

    const lossPercent = ((this.dayStartEquity - equity) / this.dayStartEquity) * 100

    if (lossPercent >= this.maxLossPercent) {
      return `Daily loss limit reached: ${lossPercent.toFixed(1)}% loss today (limit: ${this.maxLossPercent}%). Trading halted until next day.`
    }

    return null
  }
}
