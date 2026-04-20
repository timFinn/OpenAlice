import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
import { MaxPositionSizeGuard } from './max-position-size.js'
import { CooldownGuard } from './cooldown.js'
import { SymbolWhitelistGuard } from './symbol-whitelist.js'
import { MaxDailyLossGuard } from './max-daily-loss.js'
import { MaxDrawdownGuard } from './max-drawdown.js'
import { MaxOpenPositionsGuard } from './max-open-positions.js'
import { OrderRateLimitGuard } from './order-rate-limit.js'
import { MaxExposureGuard } from './max-exposure.js'
import { createGuardPipeline } from './guard-pipeline.js'
import { resolveGuards, registerGuard } from './registry.js'
import type { GuardContext, OperationGuard } from './types.js'
import type { Operation } from '../git/types.js'
import type { AccountInfo, Position } from '../brokers/types.js'
import { MockBroker, makeContract, makePosition } from '../brokers/mock/index.js'
import '../contract-ext.js'

// ==================== Helpers ====================

function makePlaceOrderOp(overrides: {
  symbol?: string
  action?: 'BUY' | 'SELL'
  orderType?: string
  cashQty?: number
  totalQuantity?: Decimal
} = {}): Operation {
  const contract = makeContract({ symbol: overrides.symbol ?? 'AAPL' })
  const order = new Order()
  order.action = overrides.action ?? 'BUY'
  order.orderType = overrides.orderType ?? 'MKT'
  order.totalQuantity = overrides.totalQuantity ?? new Decimal(10)
  if (overrides.cashQty != null) {
    order.cashQty = overrides.cashQty
  }
  return { action: 'placeOrder', contract, order }
}

function makeContext(overrides: {
  operation?: Operation
  positions?: Position[]
  account?: Partial<AccountInfo>
} = {}): GuardContext {
  return {
    operation: overrides.operation ?? makePlaceOrderOp(),
    positions: overrides.positions ?? [],
    account: {
      baseCurrency: 'USD',
      netLiquidation: '100000',
      totalCashValue: '100000',
      unrealizedPnL: '0',
      realizedPnL: '0',
      ...overrides.account,
    },
  }
}

// ==================== MaxPositionSizeGuard ====================

describe('MaxPositionSizeGuard', () => {
  it('allows order within limit', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ cashQty: 20_000 }),
      account: { netLiquidation: '100000' },
    })

    expect(guard.check(ctx)).toBeNull()
  })

  it('rejects order exceeding limit', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ cashQty: 30_000 }),
      account: { netLiquidation: '100000' },
    })

    const result = guard.check(ctx)
    expect(result).not.toBeNull()
    expect(result).toContain('30.0%')
    expect(result).toContain('limit: 25%')
  })

  it('considers existing position value', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ cashQty: 10_000 }),
      positions: [makePosition({ contract: makeContract({ symbol: 'AAPL' }), marketValue: '20000' })],
      account: { netLiquidation: '100000' },
    })

    const result = guard.check(ctx)
    expect(result).not.toBeNull()
    // 20k existing + 10k new = 30k = 30%
    expect(result).toContain('30.0%')
  })

  it('uses default 25% if no option provided', () => {
    const guard = new MaxPositionSizeGuard({})
    const ctx = makeContext({
      operation: makePlaceOrderOp({ cashQty: 26_000 }),
      account: { netLiquidation: '100000' },
    })
    expect(guard.check(ctx)).not.toBeNull()
  })

  it('skips non-placeOrder operations', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 1 })
    const contract = makeContract({ symbol: 'AAPL' })
    const ctx = makeContext({
      operation: { action: 'closePosition', contract },
    })
    expect(guard.check(ctx)).toBeNull()
  })

  it('allows when addedValue cannot be estimated (qty-based, no existing position)', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 1 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ symbol: 'NEW_STOCK', totalQuantity: new Decimal(100) }),
    })
    expect(guard.check(ctx)).toBeNull()
  })

  it('allows SELL (trim) even when existing position is near the cap', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({
        symbol: 'QQQ',
        action: 'SELL',
        totalQuantity: new Decimal(10),
      }),
      positions: [makePosition({
        contract: makeContract({ symbol: 'QQQ' }),
        marketValue: '20704',
        marketPrice: '647',
      })],
      account: { netLiquidation: '99651' },
    })
    expect(guard.check(ctx)).toBeNull()
  })

  it('allows SELL regardless of size (reducing exposure never breaches cap)', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({
        symbol: 'QQQ',
        action: 'SELL',
        totalQuantity: new Decimal(18),
      }),
      positions: [makePosition({
        contract: makeContract({ symbol: 'QQQ' }),
        marketValue: '20704',
        marketPrice: '647',
      })],
      account: { netLiquidation: '99651' },
    })
    expect(guard.check(ctx)).toBeNull()
  })
})

// ==================== CooldownGuard ====================

describe('CooldownGuard', () => {
  it('allows first trade', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60_000 })
    const ctx = makeContext()
    expect(guard.check(ctx)).toBeNull()
  })

  it('rejects rapid repeat trade for same symbol', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60_000 })
    const ctx = makeContext()

    guard.check(ctx) // first — allowed
    const result = guard.check(ctx) // second — rejected
    expect(result).not.toBeNull()
    expect(result).toContain('Cooldown active')
    expect(result).toContain('AAPL')
  })

  it('allows trade for different symbol', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60_000 })

    guard.check(makeContext({
      operation: makePlaceOrderOp({ symbol: 'AAPL' }),
    }))

    const result = guard.check(makeContext({
      operation: makePlaceOrderOp({ symbol: 'GOOG' }),
    }))
    expect(result).toBeNull()
  })

  it('skips non-placeOrder operations', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60_000 })
    const contract = makeContract({ symbol: 'AAPL' })
    const ctx = makeContext({
      operation: { action: 'closePosition', contract },
    })
    expect(guard.check(ctx)).toBeNull()
  })
})

// ==================== SymbolWhitelistGuard ====================

describe('SymbolWhitelistGuard', () => {
  it('allows whitelisted symbols', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['AAPL', 'GOOG'] })
    const ctx = makeContext()
    expect(guard.check(ctx)).toBeNull()
  })

  it('rejects non-whitelisted symbols', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['GOOG'] })
    const ctx = makeContext()
    expect(guard.check(ctx)).toContain('not in the allowed list')
  })

  it('throws on construction without symbols', () => {
    expect(() => new SymbolWhitelistGuard({})).toThrow('non-empty "symbols"')
    expect(() => new SymbolWhitelistGuard({ symbols: [] })).toThrow('non-empty "symbols"')
  })

  it('allows operations without a symbol param', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['AAPL'] })
    const ctx = makeContext({
      operation: { action: 'cancelOrder', orderId: '123' },
    })
    expect(guard.check(ctx)).toBeNull()
  })
})

// ==================== MaxDailyLossGuard ====================

describe('MaxDailyLossGuard', () => {
  it('allows trading when within daily loss limit', () => {
    const guard = new MaxDailyLossGuard({ maxDailyLossPercent: 5 })
    // First call establishes day-start equity
    guard.check(makeContext({ account: { netLiquidation: '100000' } }))
    // Second call with small loss
    const result = guard.check(makeContext({
      account: { netLiquidation: '97000' },
    }))
    expect(result).toBeNull()
  })

  it('blocks trading when daily loss limit exceeded', () => {
    const guard = new MaxDailyLossGuard({ maxDailyLossPercent: 5 })
    guard.check(makeContext({ account: { netLiquidation: '100000' } }))
    const result = guard.check(makeContext({
      account: { netLiquidation: '94000' },
    }))
    expect(result).not.toBeNull()
    expect(result).toContain('Daily loss limit')
    expect(result).toContain('6.0%')
  })

  it('blocks closePosition too (not just placeOrder)', () => {
    const guard = new MaxDailyLossGuard({ maxDailyLossPercent: 5 })
    guard.check(makeContext({ account: { netLiquidation: '100000' } }))
    const result = guard.check(makeContext({
      operation: { action: 'closePosition', contract: makeContract({ symbol: 'AAPL' }) },
      account: { netLiquidation: '90000' },
    }))
    expect(result).not.toBeNull()
  })

  it('allows cancelOrder even when loss limit hit', () => {
    const guard = new MaxDailyLossGuard({ maxDailyLossPercent: 5 })
    guard.check(makeContext({ account: { netLiquidation: '100000' } }))
    const result = guard.check(makeContext({
      operation: { action: 'cancelOrder', orderId: '123' },
      account: { netLiquidation: '90000' },
    }))
    expect(result).toBeNull()
  })

  it('uses default 5% if no option provided', () => {
    const guard = new MaxDailyLossGuard({})
    guard.check(makeContext({ account: { netLiquidation: '100000' } }))
    // 4.9% loss — should pass
    expect(guard.check(makeContext({ account: { netLiquidation: '95100' } }))).toBeNull()
    // 5.1% loss — should block
    expect(guard.check(makeContext({ account: { netLiquidation: '94900' } }))).not.toBeNull()
  })
})

// ==================== MaxDrawdownGuard ====================

describe('MaxDrawdownGuard', () => {
  it('allows trading when within drawdown limit', () => {
    const guard = new MaxDrawdownGuard({ maxDrawdownPercent: 10 })
    // HWM established at 100k
    guard.check(makeContext({ account: { netLiquidation: '100000' } }))
    const result = guard.check(makeContext({
      account: { netLiquidation: '95000' },
    }))
    expect(result).toBeNull()
  })

  it('blocks when drawdown exceeds limit', () => {
    const guard = new MaxDrawdownGuard({ maxDrawdownPercent: 10 })
    guard.check(makeContext({ account: { netLiquidation: '100000' } }))
    const result = guard.check(makeContext({
      account: { netLiquidation: '89000' },
    }))
    expect(result).not.toBeNull()
    expect(result).toContain('Drawdown limit')
    expect(result).toContain('11.0%')
  })

  it('ratchets high-water mark up, never down', () => {
    const guard = new MaxDrawdownGuard({ maxDrawdownPercent: 10 })
    guard.check(makeContext({ account: { netLiquidation: '100000' } }))
    guard.check(makeContext({ account: { netLiquidation: '110000' } }))
    // 10% drawdown from new HWM of 110k
    const result = guard.check(makeContext({
      account: { netLiquidation: '98000' },
    }))
    expect(result).not.toBeNull()
    expect(result).toContain('110000') // HWM should be 110k
  })

  it('skips non-placeOrder operations', () => {
    const guard = new MaxDrawdownGuard({ maxDrawdownPercent: 1 })
    guard.check(makeContext({ account: { netLiquidation: '100000' } }))
    const result = guard.check(makeContext({
      operation: { action: 'closePosition', contract: makeContract({ symbol: 'AAPL' }) },
      account: { netLiquidation: '50000' },
    }))
    expect(result).toBeNull()
  })
})

// ==================== MaxOpenPositionsGuard ====================

describe('MaxOpenPositionsGuard', () => {
  it('allows when under position limit', () => {
    const guard = new MaxOpenPositionsGuard({ maxPositions: 3 })
    const ctx = makeContext({
      positions: [
        makePosition({ contract: makeContract({ symbol: 'AAPL' }) }),
        makePosition({ contract: makeContract({ symbol: 'GOOG' }) }),
      ],
      operation: makePlaceOrderOp({ symbol: 'MSFT' }),
    })
    expect(guard.check(ctx)).toBeNull()
  })

  it('blocks new position when at limit', () => {
    const guard = new MaxOpenPositionsGuard({ maxPositions: 2 })
    const ctx = makeContext({
      positions: [
        makePosition({ contract: makeContract({ symbol: 'AAPL' }) }),
        makePosition({ contract: makeContract({ symbol: 'GOOG' }) }),
      ],
      operation: makePlaceOrderOp({ symbol: 'MSFT' }),
    })
    const result = guard.check(ctx)
    expect(result).not.toBeNull()
    expect(result).toContain('2/2')
  })

  it('allows adding to existing position even at limit', () => {
    const guard = new MaxOpenPositionsGuard({ maxPositions: 2 })
    const ctx = makeContext({
      positions: [
        makePosition({ contract: makeContract({ symbol: 'AAPL' }) }),
        makePosition({ contract: makeContract({ symbol: 'GOOG' }) }),
      ],
      operation: makePlaceOrderOp({ symbol: 'AAPL' }), // existing position
    })
    expect(guard.check(ctx)).toBeNull()
  })

  it('skips non-placeOrder operations', () => {
    const guard = new MaxOpenPositionsGuard({ maxPositions: 1 })
    const ctx = makeContext({
      positions: [
        makePosition({ contract: makeContract({ symbol: 'AAPL' }) }),
        makePosition({ contract: makeContract({ symbol: 'GOOG' }) }),
      ],
      operation: { action: 'closePosition', contract: makeContract({ symbol: 'AAPL' }) },
    })
    expect(guard.check(ctx)).toBeNull()
  })
})

// ==================== OrderRateLimitGuard ====================

describe('OrderRateLimitGuard', () => {
  it('allows orders within rate limit', () => {
    const guard = new OrderRateLimitGuard({ maxOrders: 3, windowMinutes: 60 })
    expect(guard.check(makeContext())).toBeNull()
    expect(guard.check(makeContext())).toBeNull()
    expect(guard.check(makeContext())).toBeNull()
  })

  it('blocks when rate limit exceeded', () => {
    const guard = new OrderRateLimitGuard({ maxOrders: 2, windowMinutes: 60 })
    guard.check(makeContext()) // 1st
    guard.check(makeContext()) // 2nd
    const result = guard.check(makeContext()) // 3rd — blocked
    expect(result).not.toBeNull()
    expect(result).toContain('Order rate limit')
    expect(result).toContain('2/2')
  })

  it('skips non-placeOrder operations', () => {
    const guard = new OrderRateLimitGuard({ maxOrders: 1, windowMinutes: 60 })
    guard.check(makeContext()) // 1st placeOrder — uses the slot
    // cancelOrder should pass even though rate limit is hit
    const result = guard.check(makeContext({
      operation: { action: 'cancelOrder', orderId: '123' },
    }))
    expect(result).toBeNull()
  })

  it('uses default 5 orders / 60 minutes', () => {
    const guard = new OrderRateLimitGuard({})
    for (let i = 0; i < 5; i++) {
      expect(guard.check(makeContext())).toBeNull()
    }
    expect(guard.check(makeContext())).not.toBeNull()
  })
})

// ==================== MaxExposureGuard ====================

describe('MaxExposureGuard', () => {
  it('allows order within exposure limit', () => {
    const guard = new MaxExposureGuard({ maxExposurePercent: 100 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ cashQty: 30_000 }),
      positions: [makePosition({ contract: makeContract({ symbol: 'AAPL' }), marketValue: '50000' })],
      account: { netLiquidation: '100000' },
    })
    expect(guard.check(ctx)).toBeNull()
  })

  it('blocks when exposure would exceed limit', () => {
    const guard = new MaxExposureGuard({ maxExposurePercent: 80 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ cashQty: 40_000 }),
      positions: [makePosition({ contract: makeContract({ symbol: 'AAPL' }), marketValue: '50000' })],
      account: { netLiquidation: '100000' },
    })
    const result = guard.check(ctx)
    expect(result).not.toBeNull()
    expect(result).toContain('Exposure limit')
    expect(result).toContain('90%') // 50k + 40k = 90k / 100k = 90%
  })

  it('sums absolute market values (handles shorts)', () => {
    const guard = new MaxExposureGuard({ maxExposurePercent: 100 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ cashQty: 30_000 }),
      positions: [
        makePosition({ contract: makeContract({ symbol: 'AAPL' }), marketValue: '50000' }),
        makePosition({ contract: makeContract({ symbol: 'GOOG' }), marketValue: -30_000 }),
      ],
      account: { netLiquidation: '100000' },
    })
    // Current exposure: |50k| + |-30k| = 80k, adding 30k = 110k / 100k = 110%
    const result = guard.check(ctx)
    expect(result).not.toBeNull()
  })

  it('skips non-placeOrder operations', () => {
    const guard = new MaxExposureGuard({ maxExposurePercent: 1 })
    const ctx = makeContext({
      operation: { action: 'closePosition', contract: makeContract({ symbol: 'AAPL' }) },
      positions: [makePosition({ contract: makeContract({ symbol: 'AAPL' }), marketValue: '100000' })],
      account: { netLiquidation: '100000' },
    })
    expect(guard.check(ctx)).toBeNull()
  })

  it('allows when exposure cannot be estimated', () => {
    const guard = new MaxExposureGuard({ maxExposurePercent: 1 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ symbol: 'NEW', totalQuantity: new Decimal(10) }),
      positions: [makePosition({ contract: makeContract({ symbol: 'AAPL' }), marketValue: '100000' })],
      account: { netLiquidation: '100000' },
    })
    // Can't estimate added exposure for new symbol with qty-based order
    expect(guard.check(ctx)).toBeNull()
  })

  it('allows SELL (trim) even when exposure is at the cap', () => {
    const guard = new MaxExposureGuard({ maxExposurePercent: 25 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({
        symbol: 'QQQ',
        action: 'SELL',
        totalQuantity: new Decimal(10),
      }),
      positions: [makePosition({
        contract: makeContract({ symbol: 'QQQ' }),
        marketValue: '20704',
        marketPrice: '647',
      })],
      account: { netLiquidation: '99651' },
    })
    expect(guard.check(ctx)).toBeNull()
  })
})

// ==================== Guard Pipeline ====================

describe('createGuardPipeline', () => {
  it('returns dispatcher directly when no guards', () => {
    const dispatcher = vi.fn().mockResolvedValue({ success: true })
    const account = new MockBroker()
    const pipeline = createGuardPipeline(dispatcher, account, [])

    // Should be the same function reference
    expect(pipeline).toBe(dispatcher)
  })

  it('passes through when all guards allow', async () => {
    const dispatcher = vi.fn().mockResolvedValue({ success: true })
    const account = new MockBroker()
    const allowGuard: OperationGuard = { name: 'allow-all', check: () => null }

    const pipeline = createGuardPipeline(dispatcher, account, [allowGuard])
    const op: Operation = makePlaceOrderOp()
    const result = await pipeline(op)

    expect(dispatcher).toHaveBeenCalledWith(op)
    expect(result).toEqual({ success: true })
  })

  it('blocks when a guard rejects', async () => {
    const dispatcher = vi.fn().mockResolvedValue({ success: true })
    const account = new MockBroker()
    const denyGuard: OperationGuard = { name: 'deny-all', check: () => 'Denied!' }

    const pipeline = createGuardPipeline(dispatcher, account, [denyGuard])
    const op: Operation = makePlaceOrderOp()
    const result = await pipeline(op) as Record<string, unknown>

    expect(dispatcher).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.error).toContain('[guard:deny-all]')
    expect(result.error).toContain('Denied!')
  })

  it('stops at first rejecting guard', async () => {
    const dispatcher = vi.fn().mockResolvedValue({ success: true })
    const account = new MockBroker()
    const guardA: OperationGuard = { name: 'A', check: vi.fn().mockReturnValue(null) }
    const guardB: OperationGuard = { name: 'B', check: vi.fn().mockReturnValue('Blocked by B') }
    const guardC: OperationGuard = { name: 'C', check: vi.fn().mockReturnValue(null) }

    const pipeline = createGuardPipeline(dispatcher, account, [guardA, guardB, guardC])
    const op: Operation = makePlaceOrderOp()
    await pipeline(op)

    expect(guardA.check).toHaveBeenCalled()
    expect(guardB.check).toHaveBeenCalled()
    expect(guardC.check).not.toHaveBeenCalled()
  })

  it('fetches positions and account info for guard context', async () => {
    const dispatcher = vi.fn().mockResolvedValue({ success: true })
    const account = new MockBroker({ accountInfo: { netLiquidation: '105000', totalCashValue: '100000', unrealizedPnL: '5000', realizedPnL: '1000' } })
    account.setPositions([makePosition()])

    let capturedCtx: GuardContext | undefined
    const spyGuard: OperationGuard = {
      name: 'spy',
      check: (ctx) => { capturedCtx = ctx; return null },
    }

    const pipeline = createGuardPipeline(dispatcher, account, [spyGuard])
    await pipeline(makePlaceOrderOp())

    expect(capturedCtx).toBeDefined()
    expect(capturedCtx!.positions).toHaveLength(1)
    expect(capturedCtx!.account.netLiquidation).toBe('105000')
  })
})

// ==================== Registry ====================

describe('resolveGuards', () => {
  it('resolves builtin guard types', () => {
    const guards = resolveGuards([
      { type: 'max-position-size', options: { maxPercentOfEquity: 25 } },
      { type: 'symbol-whitelist', options: { symbols: ['AAPL'] } },
    ])
    expect(guards).toHaveLength(2)
    expect(guards[0].name).toBe('max-position-size')
    expect(guards[1].name).toBe('symbol-whitelist')
  })

  it('skips unknown guard types with a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const guards = resolveGuards([{ type: 'nonexistent' }])
    expect(guards).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent'))
    warnSpy.mockRestore()
  })

  it('returns empty for empty config', () => {
    expect(resolveGuards([])).toEqual([])
  })
})

describe('registerGuard', () => {
  it('registers a custom guard type', () => {
    registerGuard({
      type: 'test-custom',
      create: () => ({ name: 'test-custom', check: () => null }),
    })

    const guards = resolveGuards([{ type: 'test-custom' }])
    expect(guards).toHaveLength(1)
    expect(guards[0].name).toBe('test-custom')
  })
})
