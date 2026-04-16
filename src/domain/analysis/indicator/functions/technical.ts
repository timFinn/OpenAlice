/**
 * Technical indicator functions — 纯数学计算
 *
 * RSI, BBANDS, MACD, ATR, STOCHRSI, ADX, OBV, VWAP, PIVOT
 * 接受 number[] 或 TrackedValues（自动提取 values）
 */

import { toValues, type TrackedValues } from '../types'
import { EMA, SMA } from './statistics'

type NumericInput = number[] | TrackedValues

/** Relative Strength Index (RSI) */
export function RSI(data: NumericInput, period: number = 14): number {
  const v = toValues(data)
  if (v.length < period + 1) {
    throw new Error(`RSI requires at least ${period + 1} data points, got ${v.length}`)
  }

  const changes: number[] = []
  for (let i = 1; i < v.length; i++) {
    changes.push(v[i] - v[i - 1])
  }

  const gains = changes.map((c) => (c > 0 ? c : 0))
  const losses = changes.map((c) => (c < 0 ? -c : 0))

  let avgGain = gains.slice(0, period).reduce((acc, val) => acc + val, 0) / period
  let avgLoss = losses.slice(0, period).reduce((acc, val) => acc + val, 0) / period

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
  }

  if (avgLoss === 0) {
    return 100
  }

  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** Bollinger Bands (BBANDS) */
export function BBANDS(
  data: NumericInput,
  period: number = 20,
  stdDevMultiplier: number = 2,
): { upper: number; middle: number; lower: number } {
  const v = toValues(data)
  if (v.length < period) {
    throw new Error(`BBANDS requires at least ${period} data points, got ${v.length}`)
  }

  const slice = v.slice(-period)
  const middle = slice.reduce((acc, val) => acc + val, 0) / period
  const variance = slice.reduce((acc, val) => acc + Math.pow(val - middle, 2), 0) / period
  const stdDev = Math.sqrt(variance)

  return {
    upper: middle + stdDev * stdDevMultiplier,
    middle,
    lower: middle - stdDev * stdDevMultiplier,
  }
}

/** MACD (Moving Average Convergence Divergence) */
export function MACD(
  data: NumericInput,
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): { macd: number; signal: number; histogram: number } {
  const v = toValues(data)
  if (v.length < slowPeriod + signalPeriod) {
    throw new Error(
      `MACD requires at least ${slowPeriod + signalPeriod} data points, got ${v.length}`,
    )
  }

  const fastEMA = EMA(v, fastPeriod)
  const slowEMA = EMA(v, slowPeriod)
  const macdValue = fastEMA - slowEMA

  const macdHistory: number[] = []
  for (let i = slowPeriod; i <= v.length; i++) {
    const slice = v.slice(0, i)
    const fast = EMA(slice, fastPeriod)
    const slow = EMA(slice, slowPeriod)
    macdHistory.push(fast - slow)
  }

  const signalValue = EMA(macdHistory, signalPeriod)
  const histogram = macdValue - signalValue

  return {
    macd: macdValue,
    signal: signalValue,
    histogram,
  }
}

/** Average True Range (ATR) */
export function ATR(
  highs: NumericInput,
  lows: NumericInput,
  closes: NumericInput,
  period: number = 14,
): number {
  const h = toValues(highs)
  const l = toValues(lows)
  const c = toValues(closes)
  if (h.length !== l.length || l.length !== c.length || h.length < period + 1) {
    throw new Error(`ATR requires at least ${period + 1} data points for all arrays`)
  }

  const trueRanges: number[] = []
  for (let i = 1; i < h.length; i++) {
    const tr = Math.max(
      h[i] - l[i],
      Math.abs(h[i] - c[i - 1]),
      Math.abs(l[i] - c[i - 1]),
    )
    trueRanges.push(tr)
  }

  let atr = trueRanges.slice(0, period).reduce((acc, val) => acc + val, 0) / period
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period
  }

  return atr
}

/**
 * Stochastic RSI — RSI applied to itself, normalized to 0-100.
 * More sensitive than plain RSI for detecting overbought/oversold in trending markets.
 */
export function STOCHRSI(
  data: NumericInput,
  rsiPeriod: number = 14,
  stochPeriod: number = 14,
): { stochRsi: number; k: number; d: number } {
  const v = toValues(data)
  const minLen = rsiPeriod + stochPeriod + 1
  if (v.length < minLen) {
    throw new Error(`STOCHRSI requires at least ${minLen} data points, got ${v.length}`)
  }

  // Compute RSI series
  const rsiSeries: number[] = []
  for (let i = rsiPeriod + 1; i <= v.length; i++) {
    rsiSeries.push(RSI(v.slice(0, i), rsiPeriod))
  }

  // Stochastic of RSI over last stochPeriod values
  const recentRsi = rsiSeries.slice(-stochPeriod)
  const maxRsi = Math.max(...recentRsi)
  const minRsi = Math.min(...recentRsi)
  const range = maxRsi - minRsi
  const currentRsi = recentRsi[recentRsi.length - 1]

  const stochRsi = range === 0 ? 50 : ((currentRsi - minRsi) / range) * 100

  // Compute full stochastic RSI series for smoothing
  const stochSeries: number[] = []
  for (let i = stochPeriod; i <= rsiSeries.length; i++) {
    const window = rsiSeries.slice(i - stochPeriod, i)
    const wMax = Math.max(...window)
    const wMin = Math.min(...window)
    const wRange = wMax - wMin
    const val = rsiSeries[i - 1]
    stochSeries.push(wRange === 0 ? 50 : ((val - wMin) / wRange) * 100)
  }

  // %K = SMA(stochRsiSeries, 3)
  const kSeries: number[] = []
  for (let i = 2; i < stochSeries.length; i++) {
    kSeries.push(SMA(stochSeries.slice(i - 2, i + 1), 3))
  }
  const k = kSeries.length > 0 ? kSeries[kSeries.length - 1] : stochRsi

  // %D = SMA(%K, 3)
  const d = kSeries.length >= 3 ? SMA(kSeries.slice(-3), 3) : k

  return { stochRsi, k, d }
}

/**
 * Average Directional Index (ADX) — trend strength indicator (0-100).
 * >25 = strong trend, <20 = weak/no trend.
 */
export function ADX(
  highs: NumericInput,
  lows: NumericInput,
  closes: NumericInput,
  period: number = 14,
): { adx: number; plusDI: number; minusDI: number } {
  const h = toValues(highs)
  const l = toValues(lows)
  const c = toValues(closes)
  const minLen = period * 2 + 1
  if (h.length < minLen || l.length < minLen || c.length < minLen) {
    throw new Error(`ADX requires at least ${minLen} data points, got ${h.length}`)
  }

  // Compute True Range, +DM, -DM
  const tr: number[] = []
  const plusDM: number[] = []
  const minusDM: number[] = []

  for (let i = 1; i < h.length; i++) {
    const highDiff = h[i] - h[i - 1]
    const lowDiff = l[i - 1] - l[i]

    tr.push(Math.max(
      h[i] - l[i],
      Math.abs(h[i] - c[i - 1]),
      Math.abs(l[i] - c[i - 1]),
    ))

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0)
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0)
  }

  // Smoothed averages using Wilder's smoothing (same as ATR)
  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0)
  let smoothPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0)
  let smoothMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0)

  const dxValues: number[] = []

  for (let i = period; i < tr.length; i++) {
    if (i > period) {
      smoothTR = smoothTR - smoothTR / period + tr[i]
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i]
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i]
    }

    const pdi = smoothTR === 0 ? 0 : (smoothPlusDM / smoothTR) * 100
    const mdi = smoothTR === 0 ? 0 : (smoothMinusDM / smoothTR) * 100
    const diSum = pdi + mdi
    const dx = diSum === 0 ? 0 : (Math.abs(pdi - mdi) / diSum) * 100
    dxValues.push(dx)
  }

  // ADX = smoothed average of DX
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period
  }

  const plusDI = smoothTR === 0 ? 0 : (smoothPlusDM / smoothTR) * 100
  const minusDI = smoothTR === 0 ? 0 : (smoothMinusDM / smoothTR) * 100

  return { adx, plusDI, minusDI }
}

/**
 * On-Balance Volume (OBV) — cumulative volume flow indicator.
 * Rising OBV confirms uptrend, falling OBV confirms downtrend.
 * Returns the current OBV value.
 */
export function OBV(closes: NumericInput, volumes: NumericInput): number {
  const c = toValues(closes)
  const vol = toValues(volumes)
  if (c.length !== vol.length || c.length < 2) {
    throw new Error(`OBV requires at least 2 data points with matching closes and volumes`)
  }

  let obv = 0
  for (let i = 1; i < c.length; i++) {
    if (c[i] > c[i - 1]) obv += vol[i]
    else if (c[i] < c[i - 1]) obv -= vol[i]
    // If equal, OBV unchanged
  }

  return obv
}

/**
 * VWAP — Volume Weighted Average Price.
 * Requires high, low, close, volume arrays (intraday bars).
 * Returns the cumulative VWAP for the dataset.
 */
export function VWAP(
  highs: NumericInput,
  lows: NumericInput,
  closes: NumericInput,
  volumes: NumericInput,
): number {
  const h = toValues(highs)
  const l = toValues(lows)
  const c = toValues(closes)
  const vol = toValues(volumes)
  if (h.length !== l.length || l.length !== c.length || c.length !== vol.length) {
    throw new Error('VWAP requires equal-length arrays for highs, lows, closes, volumes')
  }
  if (h.length < 1) {
    throw new Error('VWAP requires at least 1 data point')
  }

  let cumulativeTPV = 0
  let cumulativeVolume = 0

  for (let i = 0; i < h.length; i++) {
    const typicalPrice = (h[i] + l[i] + c[i]) / 3
    cumulativeTPV += typicalPrice * vol[i]
    cumulativeVolume += vol[i]
  }

  if (cumulativeVolume === 0) return c[c.length - 1]
  return cumulativeTPV / cumulativeVolume
}

/**
 * Pivot Points (Standard/Floor) — support and resistance levels.
 * Takes the most recent bar's high, low, close to compute pivot levels.
 */
export function PIVOT(
  highs: NumericInput,
  lows: NumericInput,
  closes: NumericInput,
): { pivot: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number } {
  const hv = toValues(highs)
  const lv = toValues(lows)
  const cv = toValues(closes)
  if (hv.length < 1 || lv.length < 1 || cv.length < 1) {
    throw new Error('PIVOT requires at least 1 data point')
  }

  const h = hv[hv.length - 1]
  const l = lv[lv.length - 1]
  const c = cv[cv.length - 1]

  const pivot = (h + l + c) / 3
  const r1 = 2 * pivot - l
  const s1 = 2 * pivot - h
  const r2 = pivot + (h - l)
  const s2 = pivot - (h - l)
  const r3 = h + 2 * (pivot - l)
  const s3 = l - 2 * (h - pivot)

  return { pivot, r1, r2, r3, s1, s2, s3 }
}
