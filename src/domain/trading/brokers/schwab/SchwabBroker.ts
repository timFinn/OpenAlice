/**
 * SchwabBroker — IBroker adapter for Charles Schwab Trader API
 *
 * Uses Schwab's Individual Trader API (OAuth 2.0 + REST).
 * Supports US equities (STK) with options planned.
 *
 * Auth flow: OAuth 2.0 with app key/secret → 30min access tokens,
 * 7-day refresh tokens. Managed by SchwabTokenManager.
 *
 * Takes IBKR Order objects, reads relevant fields, ignores the rest.
 */

import { z } from 'zod'
import { resolve } from 'node:path'
import Decimal from 'decimal.js'
import { Contract, ContractDescription, ContractDetails, Order, OrderState, UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
import {
  BrokerError,
  type IBroker,
  type AccountCapabilities,
  type AccountInfo,
  type Position,
  type PlaceOrderResult,
  type OpenOrder,
  type Quote,
  type MarketClock,
  type BrokerConfigField,
} from '../types.js'
import { QuoteCache } from '../../quote-cache.js'
import '../../contract-ext.js'
import { SchwabTokenManager } from './schwab-auth.js'
import type {
  SchwabBrokerConfig,
  SchwabAccountResponse,
  SchwabOrderRaw,
  SchwabQuoteResponse,
  SchwabMarketHoursResponse,
} from './schwab-types.js'
import {
  makeContract,
  resolveSymbol,
  makeOrderState,
  ibkrOrderTypeToSchwab,
  ibkrTifToSchwab,
  ibkrActionToSchwab,
} from './schwab-contracts.js'

// ==================== Constants ====================

const API_BASE = 'https://api.schwabapi.com'
const TRADER_BASE = `${API_BASE}/trader/v1`
const MARKET_DATA_BASE = `${API_BASE}/marketdata/v1`

// ==================== Broker ====================

export class SchwabBroker implements IBroker {
  // ---- Self-registration ----

  static configSchema = z.object({
    appKey: z.string().min(1),
    appSecret: z.string().min(1),
    callbackUrl: z.string().url().default('https://127.0.0.1:5556/callback'),
    accountHash: z.string().optional(),
  })

  static configFields: BrokerConfigField[] = [
    { name: 'appKey', type: 'password', label: 'App Key', required: true, sensitive: true, description: 'From Schwab Developer Portal → App Dashboard.' },
    { name: 'appSecret', type: 'password', label: 'App Secret', required: true, sensitive: true, description: 'From Schwab Developer Portal → App Dashboard.' },
    { name: 'callbackUrl', type: 'text', label: 'Callback URL', required: true, default: 'https://127.0.0.1:5556/callback', description: 'Must match the callback URL registered in your Schwab app.' },
    { name: 'accountHash', type: 'text', label: 'Account Hash', required: false, description: 'Auto-populated after first OAuth flow. Leave blank initially.' },
  ]

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): SchwabBroker {
    const bc = SchwabBroker.configSchema.parse(config.brokerConfig)
    return new SchwabBroker({
      id: config.id,
      label: config.label,
      appKey: bc.appKey,
      appSecret: bc.appSecret,
      callbackUrl: bc.callbackUrl,
      accountHash: bc.accountHash,
    })
  }

  // ---- Instance ----

  readonly id: string
  readonly label: string

  private readonly config: SchwabBrokerConfig
  private readonly auth: SchwabTokenManager
  private readonly quoteCache = new QuoteCache()
  private accountHash: string | null = null

  constructor(config: SchwabBrokerConfig) {
    this.config = config
    this.id = config.id ?? 'schwab'
    this.label = config.label ?? 'Schwab'
    this.accountHash = config.accountHash ?? null

    this.auth = new SchwabTokenManager({
      appKey: config.appKey,
      appSecret: config.appSecret,
      callbackUrl: config.callbackUrl,
      tokenFile: resolve('data/schwab', `tokens-${this.id}.json`),
    })
  }

  // ---- Lifecycle ----

  async init(): Promise<void> {
    if (!this.config.appKey || !this.config.appSecret) {
      throw new BrokerError(
        'CONFIG',
        'No API credentials configured. Set appKey and appSecret in accounts.json.',
      )
    }

    // Try to load existing tokens
    const hasTokens = await this.auth.loadFromDisk()
    if (!hasTokens) {
      throw new BrokerError(
        'AUTH',
        `Schwab requires OAuth authorization. Visit this URL to authorize:\n${this.auth.getAuthorizationUrl()}`,
      )
    }

    // Verify token works and discover account hash if not set
    try {
      if (!this.accountHash) {
        await this.discoverAccountHash()
      }
      const account = await this.fetchAccount()
      console.log(
        `SchwabBroker[${this.id}]: connected (NLV=$${account.netLiquidation.toFixed(2)})`,
      )
    } catch (err) {
      if (err instanceof BrokerError) throw err
      throw BrokerError.from(err)
    }
  }

  async close(): Promise<void> {
    this.quoteCache.clear()
  }

  // ---- Account Discovery ----

  /**
   * Fetch account numbers/hashes and use the first one.
   * Schwab uses encrypted account hashes instead of raw account numbers.
   */
  private async discoverAccountHash(): Promise<void> {
    const data = await this.request<Array<{ accountNumber: string; hashValue: string }>>(
      `${TRADER_BASE}/accounts/accountNumbers`,
    )
    if (!data.length) {
      throw new BrokerError('CONFIG', 'No accounts found on this Schwab login.')
    }
    this.accountHash = data[0].hashValue
    console.log(`SchwabBroker[${this.id}]: discovered account hash ${this.accountHash.slice(0, 8)}...`)
  }

  // ---- Contract search ----

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern) return []
    const ticker = pattern.toUpperCase()
    const desc = new ContractDescription()
    desc.contract = makeContract(ticker)
    return [desc]
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const symbol = resolveSymbol(query)
    if (!symbol) return null

    const details = new ContractDetails()
    details.contract = makeContract(symbol)
    details.validExchanges = 'SMART,NYSE,NASDAQ,ARCA'
    details.orderTypes = 'MKT,LMT,STP,STP LMT,TRAIL'
    details.stockType = 'COMMON'
    return details
  }

  // ---- Trading operations ----

  async placeOrder(contract: Contract, order: Order): Promise<PlaceOrderResult> {
    const symbol = resolveSymbol(contract)
    if (!symbol) {
      return { success: false, error: 'Cannot resolve contract to Schwab symbol' }
    }

    try {
      const schwabOrder: Record<string, unknown> = {
        orderType: ibkrOrderTypeToSchwab(order.orderType),
        session: order.outsideRth ? 'SEAMLESS' : 'NORMAL',
        duration: ibkrTifToSchwab(order.tif),
        orderStrategyType: 'SINGLE',
        orderLegCollection: [
          {
            instruction: ibkrActionToSchwab(order.action),
            quantity: order.totalQuantity.equals(UNSET_DECIMAL) ? 0 : parseFloat(order.totalQuantity.toString()),
            instrument: {
              symbol,
              assetType: 'EQUITY',
            },
          },
        ],
      }

      // Prices
      if (order.lmtPrice !== UNSET_DOUBLE) schwabOrder.price = order.lmtPrice
      if (order.auxPrice !== UNSET_DOUBLE) {
        if (order.orderType === 'TRAIL') {
          schwabOrder.stopPriceOffset = order.auxPrice
          schwabOrder.stopPriceLinkBasis = 'LAST'
          schwabOrder.stopPriceLinkType = 'VALUE'
        } else {
          schwabOrder.stopPrice = order.auxPrice
        }
      }

      const res = await this.request<void>(
        `${TRADER_BASE}/accounts/${this.accountHash}/orders`,
        { method: 'POST', body: schwabOrder },
      )

      // Schwab returns 201 with Location header containing the order ID
      // For now, return success — order ID extraction happens via the raw response
      return {
        success: true,
        orderId: undefined, // TODO: extract from Location header once HTTP layer supports it
        orderState: (() => { const s = new OrderState(); s.status = 'Submitted'; return s })(),
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    // Schwab replace = cancel + new order. Requires the full order payload.
    // For now, cancel and re-place.
    const cancelResult = await this.cancelOrder(orderId)
    if (!cancelResult.success) return cancelResult

    // TODO: re-place with modified fields once we track original order details
    return { success: false, error: 'Order modification requires cancel + re-place — not yet implemented' }
  }

  async cancelOrder(orderId: string): Promise<PlaceOrderResult> {
    try {
      await this.request<void>(
        `${TRADER_BASE}/accounts/${this.accountHash}/orders/${orderId}`,
        { method: 'DELETE' },
      )
      const orderState = new OrderState()
      orderState.status = 'Cancelled'
      return { success: true, orderId, orderState }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    const symbol = resolveSymbol(contract)
    if (!symbol) {
      return { success: false, error: 'Cannot resolve contract to Schwab symbol' }
    }

    // Determine current position side and quantity
    const positions = await this.getPositions()
    const pos = positions.find(p => p.contract.symbol === symbol)
    if (!pos) return { success: false, error: `No position for ${symbol}` }

    const order = new Order()
    order.action = pos.side === 'long' ? 'SELL' : 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = quantity ?? pos.quantity
    order.tif = 'DAY'

    return this.placeOrder(contract, order)
  }

  // ---- Queries ----

  async getAccount(): Promise<AccountInfo> {
    return this.fetchAccount()
  }

  private async fetchAccount(): Promise<AccountInfo> {
    try {
      const data = await this.request<SchwabAccountResponse>(
        `${TRADER_BASE}/accounts/${this.accountHash}?fields=positions`,
      )
      const bal = data.securitiesAccount.currentBalances
      const positions = data.securitiesAccount.positions ?? []

      const unrealizedPnL = positions.reduce(
        (sum, p) => sum + p.currentDayProfitLoss,
        0,
      )

      return {
        netLiquidation: bal.liquidationValue,
        totalCashValue: bal.totalCash,
        unrealizedPnL,
        buyingPower: bal.buyingPower,
        dayTradesRemaining: data.securitiesAccount.isDayTrader ? undefined : Math.max(0, 3 - data.securitiesAccount.roundTrips),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      const data = await this.request<SchwabAccountResponse>(
        `${TRADER_BASE}/accounts/${this.accountHash}?fields=positions`,
      )
      const positions = data.securitiesAccount.positions ?? []

      return positions
        .filter(p => p.instrument.assetType === 'EQUITY')
        .map(p => {
          const qty = p.longQuantity > 0 ? p.longQuantity : p.shortQuantity
          const side = p.longQuantity > 0 ? 'long' as const : 'short' as const
          return {
            contract: makeContract(p.instrument.symbol),
            side,
            quantity: new Decimal(qty),
            avgCost: p.averagePrice,
            marketPrice: p.marketValue / qty,
            marketValue: Math.abs(p.marketValue),
            unrealizedPnL: p.currentDayProfitLoss,
            realizedPnL: 0,
          }
        })
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    const results: OpenOrder[] = []
    for (const id of orderIds) {
      const order = await this.getOrder(id)
      if (order) results.push(order)
    }
    return results
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    try {
      const raw = await this.request<SchwabOrderRaw>(
        `${TRADER_BASE}/accounts/${this.accountHash}/orders/${orderId}`,
      )
      return this.mapOpenOrder(raw)
    } catch {
      return null
    }
  }

  async getQuote(contract: Contract): Promise<Quote> {
    const symbol = resolveSymbol(contract)
    if (!symbol) throw new BrokerError('EXCHANGE', 'Cannot resolve contract to Schwab symbol')

    return this.quoteCache.getOrFetch(symbol, async () => {
      try {
        const data = await this.request<SchwabQuoteResponse>(
          `${MARKET_DATA_BASE}/quotes?symbols=${encodeURIComponent(symbol)}&indicative=false`,
        )

        const entry = data[symbol]
        if (!entry) throw new BrokerError('EXCHANGE', `No quote data for ${symbol}`)

        return {
          contract: makeContract(symbol),
          last: entry.quote.lastPrice,
          bid: entry.quote.bidPrice,
          ask: entry.quote.askPrice,
          volume: entry.quote.totalVolume,
          high: entry.quote.highPrice,
          low: entry.quote.lowPrice,
          timestamp: new Date(entry.quote.tradeTime),
        }
      } catch (err) {
        throw BrokerError.from(err)
      }
    })
  }

  // ---- Capabilities ----

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['STK'],
      supportedOrderTypes: ['MKT', 'LMT', 'STP', 'STP LMT', 'TRAIL'],
    }
  }

  async getMarketClock(): Promise<MarketClock> {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const data = await this.request<SchwabMarketHoursResponse>(
        `${MARKET_DATA_BASE}/markets?markets=equity&date=${today}`,
      )

      // Navigate the nested response
      const equity = data.equity
      if (!equity) {
        return { isOpen: false, timestamp: new Date() }
      }

      const market = Object.values(equity)[0]
      if (!market) {
        return { isOpen: false, timestamp: new Date() }
      }

      const result: MarketClock = {
        isOpen: market.isOpen,
        timestamp: new Date(),
      }

      if (market.sessionHours?.regularMarket?.[0]) {
        const session = market.sessionHours.regularMarket[0]
        result.nextClose = new Date(session.end)
        if (!market.isOpen) {
          result.nextOpen = new Date(session.start)
        }
      }

      return result
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  // ---- Contract identity ----

  getNativeKey(contract: Contract): string {
    return contract.symbol
  }

  resolveNativeKey(nativeKey: string): Contract {
    return makeContract(nativeKey)
  }

  // ---- HTTP Client ----

  private async request<T>(url: string, opts?: { method?: string; body?: unknown }): Promise<T> {
    const token = await this.auth.getAccessToken()

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    }

    const fetchOpts: RequestInit = {
      method: opts?.method ?? 'GET',
      headers,
    }

    if (opts?.body) {
      headers['Content-Type'] = 'application/json'
      fetchOpts.body = JSON.stringify(opts.body)
    }

    const res = await fetch(url, fetchOpts)

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      const code = res.status
      if (code === 401 || code === 403) {
        throw new BrokerError('AUTH', `Schwab API auth error (${code}): ${errBody}`)
      }
      throw new BrokerError('EXCHANGE', `Schwab API error (${code}): ${errBody}`)
    }

    // DELETE and some POST calls return no body
    if (res.status === 204 || res.status === 201) {
      return undefined as T
    }

    return await res.json() as T
  }

  // ---- Internal ----

  private mapOpenOrder(o: SchwabOrderRaw): OpenOrder | null {
    const leg = o.orderLegCollection?.[0]
    if (!leg) return null

    const contract = makeContract(leg.instrument.symbol)

    const order = new Order()
    order.action = leg.instruction === 'BUY' || leg.instruction === 'BUY_TO_COVER' ? 'BUY' : 'SELL'
    order.totalQuantity = new Decimal(o.quantity)
    order.orderType = (() => {
      switch (o.orderType) {
        case 'MARKET': return 'MKT'
        case 'LIMIT': return 'LMT'
        case 'STOP': return 'STP'
        case 'STOP_LIMIT': return 'STP LMT'
        case 'TRAILING_STOP': return 'TRAIL'
        default: return o.orderType
      }
    })()
    if (o.price != null) order.lmtPrice = o.price
    if (o.stopPrice != null) order.auxPrice = o.stopPrice
    order.tif = o.duration === 'GOOD_TILL_CANCEL' ? 'GTC' : 'DAY'
    order.orderId = 0 // IBKR orderId is numeric; real ID carried via nativeOrderId

    // Calculate avg fill price from execution legs
    let avgFillPrice: number | undefined
    if (o.orderActivityCollection?.length) {
      let totalQty = 0
      let totalValue = 0
      for (const activity of o.orderActivityCollection) {
        if (activity.executionLegs) {
          for (const leg of activity.executionLegs) {
            totalQty += leg.quantity
            totalValue += leg.quantity * leg.price
          }
        }
      }
      if (totalQty > 0) avgFillPrice = totalValue / totalQty
    }

    return {
      contract,
      order,
      orderState: makeOrderState(o.status, o.statusDescription),
      nativeOrderId: String(o.orderId),
      avgFillPrice,
    }
  }
}
