/**
 * Contract resolution helpers for Schwab.
 *
 * Schwab uses standard ticker symbols for equities and OCC-format
 * option symbols. This module converts between Schwab's format
 * and IBKR Contract objects used throughout OpenAlice.
 */

import { Contract, OrderState } from '@traderalice/ibkr'
import '../../contract-ext.js'
import type { SchwabOrderStatus } from './schwab-types.js'

/** Build a fully qualified IBKR Contract for a Schwab equity ticker. */
export function makeContract(ticker: string): Contract {
  const c = new Contract()
  c.symbol = ticker
  c.secType = 'STK'
  c.exchange = 'SMART'
  c.currency = 'USD'
  return c
}

/**
 * Resolve a Contract to a Schwab symbol string.
 * For equities, this is just the ticker.
 * For options, Schwab uses OCC format internally.
 */
export function resolveSymbol(contract: Contract): string | null {
  if (!contract.symbol) return null
  // Only handle equities for now — options support will extend this
  if (contract.secType && contract.secType !== 'STK') return null
  return contract.symbol.toUpperCase()
}

/** Map Schwab order status to IBKR-style OrderState status string. */
export function mapSchwabOrderStatus(status: SchwabOrderStatus): string {
  switch (status) {
    case 'FILLED':
      return 'Filled'
    case 'ACCEPTED':
    case 'QUEUED':
    case 'WORKING':
    case 'PENDING_ACTIVATION':
    case 'AWAITING_PARENT_ORDER':
    case 'AWAITING_CONDITION':
    case 'AWAITING_STOP_CONDITION':
    case 'AWAITING_UR_OUT':
    case 'NEW':
      return 'Submitted'
    case 'CANCELED':
    case 'REPLACED':
    case 'EXPIRED':
    case 'PENDING_CANCEL':
    case 'PENDING_REPLACE':
      return 'Cancelled'
    case 'REJECTED':
      return 'Inactive'
    case 'AWAITING_MANUAL_REVIEW':
      return 'Submitted'
    default:
      return 'Submitted'
  }
}

/** Create an IBKR OrderState from a Schwab status. */
export function makeOrderState(status: SchwabOrderStatus, rejectReason?: string): OrderState {
  const s = new OrderState()
  s.status = mapSchwabOrderStatus(status)
  if (rejectReason) s.rejectReason = rejectReason
  return s
}

/** Map IBKR orderType codes to Schwab API order type strings. */
export function ibkrOrderTypeToSchwab(orderType: string): string {
  switch (orderType) {
    case 'MKT': return 'MARKET'
    case 'LMT': return 'LIMIT'
    case 'STP': return 'STOP'
    case 'STP LMT': return 'STOP_LIMIT'
    case 'TRAIL': return 'TRAILING_STOP'
    default: return orderType
  }
}

/** Map IBKR TIF codes to Schwab API duration strings. */
export function ibkrTifToSchwab(tif: string): string {
  switch (tif) {
    case 'DAY': return 'DAY'
    case 'GTC': return 'GOOD_TILL_CANCEL'
    case 'IOC': return 'IMMEDIATE_OR_CANCEL'
    case 'FOK': return 'FILL_OR_KILL'
    default: return 'DAY'
  }
}

/** Map IBKR action to Schwab instruction. */
export function ibkrActionToSchwab(action: string, isShort = false): string {
  if (action === 'BUY') return isShort ? 'BUY_TO_COVER' : 'BUY'
  if (action === 'SELL') return isShort ? 'SELL_SHORT' : 'SELL'
  return action
}
