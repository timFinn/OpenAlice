/**
 * Max Exposure Guard
 *
 * Caps total notional exposure (sum of absolute market values across
 * all positions) as a percentage of equity. Prevents over-leveraging.
 *
 * Example: with maxExposurePercent=100 and $100k equity, total
 * position value cannot exceed $100k. Set >100 to allow leverage.
 */

import { UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
import type { OperationGuard, GuardContext } from './types.js'

const DEFAULT_MAX_EXPOSURE_PERCENT = 100

export class MaxExposureGuard implements OperationGuard {
  readonly name = 'max-exposure'
  private maxExposurePercent: number

  constructor(options: Record<string, unknown>) {
    this.maxExposurePercent = Number(options.maxExposurePercent ?? DEFAULT_MAX_EXPOSURE_PERCENT)
  }

  check(ctx: GuardContext): string | null {
    if (ctx.operation.action !== 'placeOrder') return null

    const { positions, account, operation } = ctx
    const { order } = operation

    // SELL reduces long exposure (or is a short-cover) — cannot breach an exposure cap
    if (order.action === 'SELL') return null

    const equity = Number(account.netLiquidation)
    if (equity <= 0) return null

    // Sum current absolute exposure
    const currentExposure = positions.reduce((sum, p) => sum + Math.abs(Number(p.marketValue)), 0)

    // Estimate added exposure from this order
    const cashQty = order.cashQty !== UNSET_DOUBLE ? order.cashQty : undefined
    const qty = !order.totalQuantity.equals(UNSET_DECIMAL) ? order.totalQuantity.toNumber() : undefined

    let addedExposure = 0
    if (cashQty && cashQty > 0) {
      addedExposure = cashQty
    } else if (qty) {
      const symbol = operation.contract?.symbol
      const existing = positions.find(p => p.contract.symbol === symbol)
      if (existing) {
        addedExposure = qty * Number(existing.marketPrice)
      }
    }

    // If we can't estimate, allow — broker will validate
    if (addedExposure === 0) return null

    const projectedExposure = currentExposure + addedExposure
    const exposurePercent = (projectedExposure / equity) * 100

    if (exposurePercent > this.maxExposurePercent) {
      return `Exposure limit: projected ${exposurePercent.toFixed(0)}% of equity (limit: ${this.maxExposurePercent}%). Current exposure: $${currentExposure.toFixed(0)}, adding: $${addedExposure.toFixed(0)}.`
    }

    return null
  }
}
