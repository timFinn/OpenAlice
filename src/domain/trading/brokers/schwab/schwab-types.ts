/**
 * Schwab Trader API response shapes and config types.
 *
 * Based on the Schwab Individual Trader API v1 spec.
 * https://developer.schwab.com/
 */

// ==================== Config ====================

export interface SchwabBrokerConfig {
  id?: string
  label?: string
  appKey: string
  appSecret: string
  callbackUrl: string
  /** Encrypted account hash from Schwab (obtained after first OAuth flow). */
  accountHash?: string
}

// ==================== OAuth ====================

export interface SchwabTokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number       // seconds (typically 1800 = 30min)
  refresh_token: string
  scope: string
  id_token?: string
}

export interface SchwabTokenState {
  accessToken: string
  refreshToken: string
  expiresAt: number        // epoch ms
  refreshExpiresAt: number // epoch ms (7 days from refresh grant)
}

// ==================== Account ====================

export interface SchwabAccountResponse {
  securitiesAccount: {
    type: 'MARGIN' | 'CASH' | 'IRA'
    accountNumber: string
    roundTrips: number
    isDayTrader: boolean
    isClosingOnlyRestricted: boolean
    pfcbFlag: boolean
    positions?: SchwabPositionRaw[]
    currentBalances: SchwabBalances
  }
}

export interface SchwabBalances {
  availableFunds: number
  availableFundsNonMarginableTrade: number
  buyingPower: number
  buyingPowerNonMarginableTrade: number
  dayTradingBuyingPower: number
  dayTradingBuyingPowerCall: number
  equity: number
  equityPercentage: number
  longMarketValue: number
  shortMarketValue: number
  maintenanceCall: number
  maintenanceRequirement: number
  marginBalance: number
  moneyMarketFund: number
  cashBalance: number
  liquidationValue: number
  longOptionMarketValue: number
  shortOptionMarketValue: number
  totalCash: number
}

// ==================== Positions ====================

export interface SchwabPositionRaw {
  shortQuantity: number
  averagePrice: number
  currentDayProfitLoss: number
  currentDayProfitLossPercentage: number
  longQuantity: number
  settledLongQuantity: number
  settledShortQuantity: number
  instrument: SchwabInstrument
  marketValue: number
  maintenanceRequirement: number
  averageLongPrice: number
  averageShortPrice: number
  currentDayCost: number
  previousSessionLongQuantity: number
  previousSessionShortQuantity: number
}

export interface SchwabInstrument {
  assetType: 'EQUITY' | 'OPTION' | 'MUTUAL_FUND' | 'CASH_EQUIVALENT' | 'FIXED_INCOME' | 'INDEX'
  cusip: string
  symbol: string
  description?: string
  netChange?: number
  type?: string
  /** Options only */
  putCall?: 'PUT' | 'CALL'
  underlyingSymbol?: string
}

// ==================== Orders ====================

export interface SchwabOrderRaw {
  session: 'NORMAL' | 'AM' | 'PM' | 'SEAMLESS'
  duration: 'DAY' | 'GOOD_TILL_CANCEL' | 'FILL_OR_KILL' | 'IMMEDIATE_OR_CANCEL'
  orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT' | 'TRAILING_STOP' | 'NET_DEBIT' | 'NET_CREDIT' | 'NET_ZERO'
  complexOrderStrategyType: 'NONE' | 'COVERED' | 'VERTICAL' | 'BACK_RATIO' | 'CALENDAR' | 'DIAGONAL' | 'STRADDLE' | 'STRANGLE' | 'COLLAR_SYNTHETIC' | 'BUTTERFLY' | 'CONDOR' | 'IRON_CONDOR' | 'VERTICAL_ROLL' | 'COLLAR_WITH_STOCK' | 'DOUBLE_DIAGONAL' | 'UNBALANCED_BUTTERFLY' | 'UNBALANCED_CONDOR' | 'UNBALANCED_IRON_CONDOR' | 'UNBALANCED_VERTICAL_ROLL' | 'CUSTOM'
  quantity: number
  filledQuantity: number
  remainingQuantity: number
  requestedDestination: string
  destinationLinkName: string
  price?: number             // limit price
  stopPrice?: number
  stopPriceLinkBasis?: string
  stopPriceLinkType?: string
  stopPriceOffset?: number
  orderLegCollection: SchwabOrderLeg[]
  orderStrategyType: 'SINGLE' | 'OCO' | 'TRIGGER'
  orderId: number
  cancelable: boolean
  editable: boolean
  status: SchwabOrderStatus
  enteredTime: string
  closeTime?: string
  tag?: string
  accountNumber: number
  statusDescription?: string
  orderActivityCollection?: SchwabOrderActivity[]
}

export type SchwabOrderStatus =
  | 'AWAITING_PARENT_ORDER'
  | 'AWAITING_CONDITION'
  | 'AWAITING_STOP_CONDITION'
  | 'AWAITING_MANUAL_REVIEW'
  | 'ACCEPTED'
  | 'AWAITING_UR_OUT'
  | 'PENDING_ACTIVATION'
  | 'QUEUED'
  | 'WORKING'
  | 'REJECTED'
  | 'PENDING_CANCEL'
  | 'CANCELED'
  | 'PENDING_REPLACE'
  | 'REPLACED'
  | 'FILLED'
  | 'EXPIRED'
  | 'NEW'
  | 'UNKNOWN'

export interface SchwabOrderLeg {
  orderLegType: 'EQUITY' | 'OPTION' | 'INDEX' | 'MUTUAL_FUND' | 'CASH_EQUIVALENT' | 'FIXED_INCOME' | 'CURRENCY'
  legId: number
  instrument: SchwabInstrument
  instruction: 'BUY' | 'SELL' | 'BUY_TO_COVER' | 'SELL_SHORT' | 'BUY_TO_OPEN' | 'BUY_TO_CLOSE' | 'SELL_TO_OPEN' | 'SELL_TO_CLOSE'
  positionEffect: 'OPENING' | 'CLOSING' | 'AUTOMATIC'
  quantity: number
}

export interface SchwabOrderActivity {
  activityType: 'EXECUTION' | 'ORDER_ACTION'
  executionType?: 'FILL'
  quantity?: number
  orderRemainingQuantity?: number
  executionLegs?: Array<{
    legId: number
    quantity: number
    mismarkedQuantity: number
    price: number
    time: string
  }>
}

// ==================== Quotes ====================

export interface SchwabQuoteResponse {
  [symbol: string]: {
    assetMainType: string
    assetSubType?: string
    quoteType?: string
    realtime: boolean
    ssid: number
    symbol: string
    quote: {
      '52WeekHigh': number
      '52WeekLow': number
      askMICId: string
      askPrice: number
      askSize: number
      askTime: number
      bidMICId: string
      bidPrice: number
      bidSize: number
      bidTime: number
      closePrice: number
      highPrice: number
      lastMICId: string
      lastPrice: number
      lastSize: number
      lowPrice: number
      mark: number
      markChange: number
      markPercentChange: number
      netChange: number
      netPercentChange: number
      openPrice: number
      quoteTime: number
      securityStatus: string
      totalVolume: number
      tradeTime: number
    }
    reference: {
      cusip: string
      description: string
      exchange: string
      exchangeName: string
      isHardToBorrow: boolean
      isShortable: boolean
      htbRate: number
    }
    regular: {
      regularMarketLastPrice: number
      regularMarketLastSize: number
      regularMarketNetChange: number
      regularMarketPercentChange: number
      regularMarketTradeTime: number
    }
  }
}

// ==================== Market Hours ====================

export interface SchwabMarketHoursResponse {
  [marketType: string]: {
    [market: string]: {
      date: string
      marketType: string
      exchange: string
      category: string
      product: string
      productName: string
      isOpen: boolean
      sessionHours?: {
        preMarket?: Array<{ start: string; end: string }>
        regularMarket?: Array<{ start: string; end: string }>
        postMarket?: Array<{ start: string; end: string }>
      }
    }
  }
}
