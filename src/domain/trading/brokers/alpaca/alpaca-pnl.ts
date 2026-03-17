/**
 * Realized PnL calculation via FIFO lot matching.
 *
 * Uses Decimal.js throughout to avoid IEEE 754 precision loss
 * in financial calculations.
 */

import Decimal from 'decimal.js'
import type { AlpacaFillActivityRaw } from './alpaca-types.js'

/**
 * FIFO lot matching: track buy lots per symbol, realize PnL on sells.
 * Handles both long-only and short-selling (sell before buy → short lots).
 */
export function computeRealizedPnL(fills: AlpacaFillActivityRaw[]): number {
  // Per-symbol FIFO queue: { qty, price }[]
  // Positive qty = long lot, negative qty = short lot
  const lots = new Map<string, Array<{ qty: Decimal; price: Decimal }>>()
  let totalRealized = new Decimal(0)

  for (const fill of fills) {
    const symbol = fill.symbol
    const price = new Decimal(fill.price)
    const qty = new Decimal(fill.qty)
    const isBuy = fill.side === 'buy'

    if (!lots.has(symbol)) lots.set(symbol, [])
    const queue = lots.get(symbol)!

    // Determine if this fill opens or closes
    // Opening: buy when no short lots (or queue empty), sell when no long lots
    // Closing: buy against short lots, sell against long lots
    let remaining = qty

    while (remaining.gt(0) && queue.length > 0) {
      const front = queue[0]
      const isClosing = isBuy ? front.qty.isNeg() : front.qty.isPos()

      if (!isClosing) break // Same direction → this fill opens new lots

      const matchQty = Decimal.min(remaining, front.qty.abs())

      if (front.qty.isPos()) {
        // Closing long: sell at `price`, entry was `front.price`
        totalRealized = totalRealized.plus(matchQty.mul(price.minus(front.price)))
      } else {
        // Closing short: buy at `price`, entry was `front.price`
        totalRealized = totalRealized.plus(matchQty.mul(front.price.minus(price)))
      }

      remaining = remaining.minus(matchQty)
      front.qty = isBuy ? front.qty.plus(matchQty) : front.qty.minus(matchQty)

      if (front.qty.abs().lt(1e-10)) queue.shift() // lot fully consumed
    }

    // Remaining qty opens new lots
    if (remaining.gt(0)) {
      queue.push({ qty: isBuy ? remaining : remaining.neg(), price })
    }
  }

  // Round to cents
  return totalRealized.toDecimalPlaces(2).toNumber()
}
