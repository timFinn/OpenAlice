/**
 * Max Open Positions Guard
 *
 * Blocks placeOrder when the total number of distinct positions
 * would exceed a configurable limit. Only blocks NEW positions —
 * adding to an existing position is allowed.
 */

import type { OperationGuard, GuardContext } from './types.js'

const DEFAULT_MAX_POSITIONS = 10

export class MaxOpenPositionsGuard implements OperationGuard {
  readonly name = 'max-open-positions'
  private maxPositions: number

  constructor(options: Record<string, unknown>) {
    this.maxPositions = Number(options.maxPositions ?? DEFAULT_MAX_POSITIONS)
  }

  check(ctx: GuardContext): string | null {
    if (ctx.operation.action !== 'placeOrder') return null

    const symbol = ctx.operation.contract?.symbol
    const currentPositions = ctx.positions

    // If we already hold this symbol, this is an add — allow
    if (symbol && currentPositions.some(p => p.contract.symbol === symbol)) {
      return null
    }

    // New position — check count
    if (currentPositions.length >= this.maxPositions) {
      return `Position limit reached: ${currentPositions.length}/${this.maxPositions} positions open. Close a position before opening new ones.`
    }

    return null
  }
}
