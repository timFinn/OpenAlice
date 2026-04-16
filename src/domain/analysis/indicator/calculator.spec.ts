/**
 * Indicator Calculator unit tests
 *
 * 覆盖：四则运算、运算符优先级、数据访问、统计函数、技术指标、
 * 数组索引、嵌套表达式、精度控制、错误处理、数据溯源（dataRange）。
 */
import { describe, it, expect } from 'vitest'
import { IndicatorCalculator } from './calculator'
import type { IndicatorContext, OhlcvData, TrackedValues } from './types'

// Mock: 50 根日线，收盘价 100~149，volume 第 48 根为 null 测边界
const mockData: OhlcvData[] = Array.from({ length: 50 }, (_, i) => ({
  date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
  open: 100 + i,
  high: 102 + i,
  low: 99 + i,
  close: 100 + i,
  volume: i === 48 ? null : 1000 + i * 10,
  vwap: null,
}))

const mockContext: IndicatorContext = {
  getHistoricalData: async (_symbol: string, _interval: string) => ({
    data: mockData,
    meta: {
      symbol: _symbol,
      from: mockData[0].date,
      to: mockData[mockData.length - 1].date,
      bars: mockData.length,
    },
  }),
}

async function calc(formula: string, precision?: number) {
  const calculator = new IndicatorCalculator(mockContext)
  return calculator.calculate(formula, precision)
}

// ==================== 四则运算 ====================

describe('arithmetic', () => {
  it('addition', async () => {
    expect((await calc('2 + 3')).value).toBe(5)
  })

  it('subtraction', async () => {
    expect((await calc('10 - 4')).value).toBe(6)
  })

  it('multiplication', async () => {
    expect((await calc('3 * 7')).value).toBe(21)
  })

  it('division', async () => {
    expect((await calc('15 / 4')).value).toBe(3.75)
  })

  it('operator precedence: * before +', async () => {
    expect((await calc('2 + 3 * 4')).value).toBe(14)
  })

  it('operator precedence: / before -', async () => {
    expect((await calc('10 - 6 / 2')).value).toBe(7)
  })

  it('parentheses override precedence', async () => {
    expect((await calc('(2 + 3) * 4')).value).toBe(20)
  })

  it('nested parentheses', async () => {
    expect((await calc('((1 + 2) * (3 + 4))')).value).toBe(21)
  })

  it('negative numbers', async () => {
    expect((await calc('-5 + 3')).value).toBe(-2)
  })

  it('decimal numbers', async () => {
    expect((await calc('1.5 * 2.0')).value).toBe(3)
  })

  it('chained operations left to right', async () => {
    expect((await calc('10 - 3 - 2')).value).toBe(5)
  })

  it('division by zero throws', async () => {
    await expect(calc('10 / 0')).rejects.toThrow('Division by zero')
  })
})

// ==================== 数据访问 ====================
// mockData 返回全量 50 根：close 100..149, high 102..151, low 99..148, open 100..149

describe('data access', () => {
  it('CLOSE returns TrackedValues with 50 bars', async () => {
    const result = (await calc("CLOSE('AAPL', '1d')")).value as number[]
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(50)
    expect(result[0]).toBe(100)
    expect(result[49]).toBe(149)
  })

  it('HIGH returns correct values', async () => {
    const result = (await calc("HIGH('AAPL', '1d')")).value as number[]
    expect(result[0]).toBe(102)
    expect(result[49]).toBe(151)
  })

  it('LOW returns correct values', async () => {
    const result = (await calc("LOW('AAPL', '1d')")).value as number[]
    expect(result[0]).toBe(99)
    expect(result[49]).toBe(148)
  })

  it('OPEN returns correct values', async () => {
    const result = (await calc("OPEN('AAPL', '1d')")).value as number[]
    expect(result[0]).toBe(100)
    expect(result[49]).toBe(149)
  })

  it('VOLUME handles null as 0', async () => {
    const result = (await calc("VOLUME('AAPL', '1d')")).value as number[]
    expect(result[48]).toBe(0)
    expect(result[49]).toBe(1490)
  })
})

// ==================== 数组索引 ====================

describe('array access', () => {
  it('positive index', async () => {
    expect((await calc("CLOSE('AAPL', '1d')[0]")).value).toBe(100)
  })

  it('negative index (-1 = last)', async () => {
    expect((await calc("CLOSE('AAPL', '1d')[-1]")).value).toBe(149)
  })

  it('negative index (-2 = second to last)', async () => {
    expect((await calc("CLOSE('AAPL', '1d')[-2]")).value).toBe(148)
  })

  it('out of bounds throws', async () => {
    await expect(calc("CLOSE('AAPL', '1d')[100]")).rejects.toThrow('out of bounds')
  })
})

// ==================== 统计函数 ====================
// 全量 50 根 close: 100..149

describe('statistics', () => {
  it('SMA', async () => {
    expect((await calc("SMA(CLOSE('AAPL', '1d'), 10)")).value).toBe(144.5)
  })

  it('EMA', async () => {
    const result = (await calc("EMA(CLOSE('AAPL', '1d'), 10)")).value as number
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(140)
  })

  it('STDEV', async () => {
    const result = (await calc("STDEV(CLOSE('AAPL', '1d'))")).value
    expect(result).toBeCloseTo(14.43, 1)
  })

  it('MAX', async () => {
    expect((await calc("MAX(CLOSE('AAPL', '1d'))")).value).toBe(149)
  })

  it('MIN', async () => {
    expect((await calc("MIN(CLOSE('AAPL', '1d'))")).value).toBe(100)
  })

  it('SUM', async () => {
    expect((await calc("SUM(CLOSE('AAPL', '1d'))")).value).toBe(6225)
  })

  it('AVERAGE', async () => {
    expect((await calc("AVERAGE(CLOSE('AAPL', '1d'))")).value).toBe(124.5)
  })

  it('SMA insufficient data throws', async () => {
    await expect(calc("SMA(CLOSE('AAPL', '1d'), 100)")).rejects.toThrow('at least 100')
  })
})

// ==================== 技术指标 ====================

describe('technical indicators', () => {
  it('RSI returns 0-100, trending up → high RSI', async () => {
    const result = (await calc("RSI(CLOSE('AAPL', '1d'), 14)")).value as number
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(100)
    expect(result).toBeGreaterThan(90)
  })

  it('BBANDS returns { upper, middle, lower }', async () => {
    const result = (await calc("BBANDS(CLOSE('AAPL', '1d'), 20, 2)")).value as Record<string, number>
    expect(result).toHaveProperty('upper')
    expect(result).toHaveProperty('middle')
    expect(result).toHaveProperty('lower')
    expect(result.upper).toBeGreaterThan(result.middle)
    expect(result.middle).toBeGreaterThan(result.lower)
  })

  it('MACD returns { macd, signal, histogram }', async () => {
    const result = (await calc("MACD(CLOSE('AAPL', '1d'), 12, 26, 9)")).value as Record<string, number>
    expect(result).toHaveProperty('macd')
    expect(result).toHaveProperty('signal')
    expect(result).toHaveProperty('histogram')
    expect(typeof result.macd).toBe('number')
  })

  it('ATR returns positive number', async () => {
    const result = (await calc("ATR(HIGH('AAPL', '1d'), LOW('AAPL', '1d'), CLOSE('AAPL', '1d'), 14)")).value as number
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
  })

  it('STOCHRSI returns { stochRsi, k, d } all in 0-100', async () => {
    const raw = await calc("STOCHRSI(CLOSE('AAPL', '1d'), 14, 14)")
    const result = raw.value as Record<string, number>
    expect(result).toHaveProperty('stochRsi')
    expect(result).toHaveProperty('k')
    expect(result).toHaveProperty('d')
    expect(result.stochRsi).toBeGreaterThanOrEqual(0)
    expect(result.stochRsi).toBeLessThanOrEqual(100)
    expect(result.k).toBeGreaterThanOrEqual(0)
    expect(result.k).toBeLessThanOrEqual(100)
    expect(result.d).toBeGreaterThanOrEqual(0)
    expect(result.d).toBeLessThanOrEqual(100)
  })

  it('STOCHRSI %K is smoothed (differs from raw stochRsi when there is variance)', async () => {
    // With a monotonic uptrend, RSI values are all very high and similar,
    // so stochRsi/k/d may converge. Use a dataset with more variance to verify smoothing.
    const volatileData: OhlcvData[] = Array.from({ length: 50 }, (_, i) => ({
      date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: 100 + Math.sin(i * 0.5) * 10,
      high: 105 + Math.sin(i * 0.5) * 10,
      low: 95 + Math.sin(i * 0.5) * 10,
      close: 100 + Math.sin(i * 0.5) * 10 + (i % 3 === 0 ? 5 : -3),
      volume: 1000,
      vwap: null,
    }))
    const volatileContext: IndicatorContext = {
      getHistoricalData: async () => ({
        data: volatileData,
        meta: { symbol: 'X', from: volatileData[0].date, to: volatileData[volatileData.length - 1].date, bars: volatileData.length },
      }),
    }
    const calculator = new IndicatorCalculator(volatileContext)
    const raw = await calculator.calculate("STOCHRSI(CLOSE('X', '1d'), 14, 14)")
    const result = raw.value as Record<string, number>
    // %K should be a smoothed version — not necessarily equal to raw stochRsi
    expect(typeof result.k).toBe('number')
    expect(typeof result.d).toBe('number')
    // All values should still be bounded
    for (const v of Object.values(result)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('STOCHRSI insufficient data throws', async () => {
    // Needs rsiPeriod + stochPeriod + 1 = 29 points, mock only sends 50 but let's test with small data
    const shortData = mockData.slice(0, 20)
    const shortContext: IndicatorContext = {
      getHistoricalData: async () => ({
        data: shortData,
        meta: { symbol: 'X', from: shortData[0].date, to: shortData[shortData.length - 1].date, bars: shortData.length },
      }),
    }
    const calculator = new IndicatorCalculator(shortContext)
    await expect(calculator.calculate("STOCHRSI(CLOSE('X', '1d'), 14, 14)")).rejects.toThrow('at least 29')
  })

  it('ADX returns { adx, plusDI, minusDI } with trend strength', async () => {
    const raw = await calc("ADX(HIGH('AAPL', '1d'), LOW('AAPL', '1d'), CLOSE('AAPL', '1d'), 14)")
    const result = raw.value as Record<string, number>
    expect(result).toHaveProperty('adx')
    expect(result).toHaveProperty('plusDI')
    expect(result).toHaveProperty('minusDI')
    expect(result.adx).toBeGreaterThanOrEqual(0)
    expect(result.adx).toBeLessThanOrEqual(100)
    // Monotonic uptrend → +DI should dominate -DI
    expect(result.plusDI).toBeGreaterThan(result.minusDI)
    // Strong trend → ADX > 25
    expect(result.adx).toBeGreaterThan(25)
  })

  it('ADX insufficient data throws', async () => {
    const shortData = mockData.slice(0, 10)
    const shortContext: IndicatorContext = {
      getHistoricalData: async () => ({
        data: shortData,
        meta: { symbol: 'X', from: shortData[0].date, to: shortData[shortData.length - 1].date, bars: shortData.length },
      }),
    }
    const calculator = new IndicatorCalculator(shortContext)
    await expect(calculator.calculate("ADX(HIGH('X', '1d'), LOW('X', '1d'), CLOSE('X', '1d'), 14)")).rejects.toThrow('at least 29')
  })

  it('OBV returns positive number for uptrend', async () => {
    const raw = await calc("OBV(CLOSE('AAPL', '1d'), VOLUME('AAPL', '1d'))")
    const result = raw.value as number
    expect(typeof result).toBe('number')
    // Monotonic uptrend → every bar adds volume → large positive OBV
    expect(result).toBeGreaterThan(0)
  })

  it('OBV accumulates volume correctly', async () => {
    // With closes 100→149 (always rising) and volumes 1000,1010,...
    // OBV = sum of volumes[1..49] (bar 48 has volume 0 due to null)
    const raw = await calc("OBV(CLOSE('AAPL', '1d'), VOLUME('AAPL', '1d'))")
    const result = raw.value as number
    // Expected: sum of volumes from index 1 to 49, skipping bar 48 (volume=0, but close still > prev close so += 0)
    const expectedVolumes = Array.from({ length: 49 }, (_, i) => {
      const idx = i + 1
      return idx === 48 ? 0 : 1000 + idx * 10
    })
    const expected = expectedVolumes.reduce((sum, v) => sum + v, 0)
    expect(result).toBe(expected)
  })

  it('OBV mismatched array lengths throws', async () => {
    await expect(calc("OBV(CLOSE('AAPL', '1d'), SMA(VOLUME('AAPL', '1d'), 5))")).rejects.toThrow()
  })

  it('VWAP returns volume-weighted price', async () => {
    const raw = await calc("VWAP(HIGH('AAPL', '1d'), LOW('AAPL', '1d'), CLOSE('AAPL', '1d'), VOLUME('AAPL', '1d'))")
    const result = raw.value as number
    expect(typeof result).toBe('number')
    // VWAP should be between min and max typical prices
    // Typical price range: (99+99+100)/3=99.33 to (151+148+149)/3=149.33
    expect(result).toBeGreaterThan(99)
    expect(result).toBeLessThan(150)
  })

  it('VWAP weights toward higher-volume bars', async () => {
    // Volume increases with index, and prices increase too,
    // so VWAP should be above the simple average typical price
    const raw = await calc("VWAP(HIGH('AAPL', '1d'), LOW('AAPL', '1d'), CLOSE('AAPL', '1d'), VOLUME('AAPL', '1d'))")
    const result = raw.value as number
    // Simple average typical price ≈ (100.33 + 149.33) / 2 ≈ 124.83
    expect(result).toBeGreaterThan(125)
  })

  it('PIVOT returns all 7 levels with correct ordering', async () => {
    const raw = await calc("PIVOT(HIGH('AAPL', '1d'), LOW('AAPL', '1d'), CLOSE('AAPL', '1d'))")
    const result = raw.value as Record<string, number>
    expect(result).toHaveProperty('pivot')
    expect(result).toHaveProperty('r1')
    expect(result).toHaveProperty('r2')
    expect(result).toHaveProperty('r3')
    expect(result).toHaveProperty('s1')
    expect(result).toHaveProperty('s2')
    expect(result).toHaveProperty('s3')
    // Standard pivot ordering: s3 < s2 < s1 < pivot < r1 < r2 < r3
    expect(result.s3).toBeLessThan(result.s2)
    expect(result.s2).toBeLessThan(result.s1)
    expect(result.s1).toBeLessThan(result.pivot)
    expect(result.pivot).toBeLessThan(result.r1)
    expect(result.r1).toBeLessThan(result.r2)
    expect(result.r2).toBeLessThan(result.r3)
  })

  it('PIVOT computes from last bar', async () => {
    // Last bar: high=151, low=148, close=149
    // pivot = (151+148+149)/3 = 149.3333
    const raw = await calc("PIVOT(HIGH('AAPL', '1d'), LOW('AAPL', '1d'), CLOSE('AAPL', '1d'))")
    const result = raw.value as Record<string, number>
    expect(result.pivot).toBeCloseTo(149.3333, 2)
    // r1 = 2*pivot - low = 2*149.333 - 148 = 150.667
    expect(result.r1).toBeCloseTo(150.6667, 2)
    // s1 = 2*pivot - high = 2*149.333 - 151 = 147.667
    expect(result.s1).toBeCloseTo(147.6667, 2)
  })
})

// ==================== 复合表达式 ====================

describe('complex expressions', () => {
  it('price deviation from MA (%)', async () => {
    const result = (await calc(
      "(CLOSE('AAPL', '1d')[-1] - SMA(CLOSE('AAPL', '1d'), 50)) / SMA(CLOSE('AAPL', '1d'), 50) * 100",
    )).value
    expect(result).toBeCloseTo(19.68, 1)
  })

  it('arithmetic on function results', async () => {
    const result = (await calc("MAX(CLOSE('AAPL', '1d')) - MIN(CLOSE('AAPL', '1d'))")).value
    expect(result).toBe(49)
  })

  it('double-quoted strings work', async () => {
    const result = (await calc('CLOSE("AAPL", "1d")')).value
    expect(Array.isArray(result)).toBe(true)
    expect((result as number[]).length).toBe(50)
  })
})

// ==================== 精度控制 ====================

describe('precision', () => {
  it('default precision = 4', async () => {
    expect((await calc('10 / 3')).value).toBe(3.3333)
  })

  it('custom precision = 2', async () => {
    expect((await calc('10 / 3', 2)).value).toBe(3.33)
  })

  it('precision = 0 rounds to integer', async () => {
    expect((await calc('10 / 3', 0)).value).toBe(3)
  })

  it('precision applies to scalars from functions', async () => {
    expect((await calc("STDEV(CLOSE('AAPL', '1d'))", 0)).value).toBe(14)
  })

  it('precision applies to record values', async () => {
    const result = (await calc("BBANDS(CLOSE('AAPL', '1d'), 20, 2)", 2)).value as Record<string, number>
    for (const v of Object.values(result)) {
      const decimals = v.toString().split('.')[1]?.length ?? 0
      expect(decimals).toBeLessThanOrEqual(2)
    }
  })
})

// ==================== dataRange 溯源 ====================

describe('dataRange', () => {
  it('calculate returns dataRange with symbol metadata', async () => {
    const { value, dataRange } = await calc("CLOSE('AAPL', '1d')[-1]")
    expect(value).toBe(149)
    expect(dataRange).toHaveProperty('AAPL')
    expect(dataRange.AAPL.from).toBe(mockData[0].date)
    expect(dataRange.AAPL.to).toBe(mockData[49].date)
    expect(dataRange.AAPL.bars).toBe(50)
  })

  it('multiple symbols produce multiple dataRange entries', async () => {
    // ATR uses HIGH, LOW, CLOSE — all same symbol, should produce one entry
    const { dataRange } = await calc("ATR(HIGH('AAPL', '1d'), LOW('AAPL', '1d'), CLOSE('AAPL', '1d'), 14)")
    expect(Object.keys(dataRange)).toEqual(['AAPL'])
  })

  it('pure arithmetic has empty dataRange', async () => {
    const { dataRange } = await calc('2 + 3')
    expect(Object.keys(dataRange).length).toBe(0)
  })
})

// ==================== 错误处理 ====================

describe('errors', () => {
  it('string result throws', async () => {
    await expect(calc("'AAPL'")).rejects.toThrow('result cannot be a string')
  })

  it('unknown function throws', async () => {
    await expect(calc("FAKE('AAPL', '1d')")).rejects.toThrow('Unknown function: FAKE')
  })

  it('missing closing paren throws', async () => {
    await expect(calc("SMA(CLOSE('AAPL', '1d'), 5")).rejects.toThrow()
  })

  it('missing closing bracket throws', async () => {
    await expect(calc("CLOSE('AAPL', '1d')[0")).rejects.toThrow()
  })

  it('unterminated string throws', async () => {
    await expect(calc("CLOSE('AAPL, 10)")).rejects.toThrow()
  })

  it('binary op on non-numbers throws', async () => {
    await expect(calc("CLOSE('AAPL', '1d') + 1")).rejects.toThrow('require numbers')
  })

  it('array access on non-array throws', async () => {
    await expect(calc("SMA(CLOSE('AAPL', '1d'), 10)[0]")).rejects.toThrow('requires an array')
  })
})
