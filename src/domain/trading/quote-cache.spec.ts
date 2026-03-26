import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QuoteCache } from './quote-cache.js'
import type { Quote } from './brokers/types.js'
import { Contract } from '@traderalice/ibkr'

function makeQuote(symbol: string, last = 150): Quote {
  const contract = new Contract()
  contract.symbol = symbol
  return {
    contract,
    last,
    bid: last - 0.01,
    ask: last + 0.01,
    volume: 1_000_000,
    timestamp: new Date(),
  }
}

describe('QuoteCache', () => {
  let cache: QuoteCache

  beforeEach(() => {
    cache = new QuoteCache(100) // 100ms staleness for fast tests
  })

  describe('get/set', () => {
    it('returns null for unknown symbol', () => {
      expect(cache.get('AAPL')).toBeNull()
    })

    it('returns cached quote when fresh', () => {
      const quote = makeQuote('AAPL', 150)
      cache.set('AAPL', quote)
      const result = cache.get('AAPL')
      expect(result).not.toBeNull()
      expect(result!.last).toBe(150)
    })

    it('returns null when quote is stale', async () => {
      cache.set('AAPL', makeQuote('AAPL'))
      // Wait for staleness threshold
      await new Promise(r => setTimeout(r, 120))
      expect(cache.get('AAPL')).toBeNull()
    })

    it('updates existing entry', () => {
      cache.set('AAPL', makeQuote('AAPL', 150))
      cache.set('AAPL', makeQuote('AAPL', 155))
      expect(cache.get('AAPL')!.last).toBe(155)
    })
  })

  describe('getOrFetch', () => {
    it('returns cached quote without calling fetcher', async () => {
      cache.set('AAPL', makeQuote('AAPL', 150))
      const fetcher = vi.fn().mockResolvedValue(makeQuote('AAPL', 999))
      const result = await cache.getOrFetch('AAPL', fetcher)
      expect(result.last).toBe(150)
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('calls fetcher when cache misses', async () => {
      const fetcher = vi.fn().mockResolvedValue(makeQuote('AAPL', 160))
      const result = await cache.getOrFetch('AAPL', fetcher)
      expect(result.last).toBe(160)
      expect(fetcher).toHaveBeenCalledOnce()
    })

    it('calls fetcher when cache is stale', async () => {
      cache.set('AAPL', makeQuote('AAPL', 150))
      await new Promise(r => setTimeout(r, 120))
      const fetcher = vi.fn().mockResolvedValue(makeQuote('AAPL', 155))
      const result = await cache.getOrFetch('AAPL', fetcher)
      expect(result.last).toBe(155)
      expect(fetcher).toHaveBeenCalledOnce()
    })

    it('caches the fetched result', async () => {
      const fetcher = vi.fn().mockResolvedValue(makeQuote('AAPL', 160))
      await cache.getOrFetch('AAPL', fetcher)
      // Second call should hit cache
      const fetcher2 = vi.fn().mockResolvedValue(makeQuote('AAPL', 999))
      const result = await cache.getOrFetch('AAPL', fetcher2)
      expect(result.last).toBe(160)
      expect(fetcher2).not.toHaveBeenCalled()
    })
  })

  describe('subscriptions', () => {
    it('tracks subscriptions', () => {
      cache.subscribe('AAPL')
      cache.subscribe('GOOG')
      expect(cache.getSubscriptions()).toEqual(expect.arrayContaining(['AAPL', 'GOOG']))
      expect(cache.getSubscriptions()).toHaveLength(2)
    })

    it('deduplicates subscriptions', () => {
      cache.subscribe('AAPL')
      cache.subscribe('AAPL')
      expect(cache.getSubscriptions()).toHaveLength(1)
    })
  })

  describe('has/size/clear', () => {
    it('has returns true for cached symbols', () => {
      cache.set('AAPL', makeQuote('AAPL'))
      expect(cache.has('AAPL')).toBe(true)
      expect(cache.has('GOOG')).toBe(false)
    })

    it('size reflects cache entries', () => {
      expect(cache.size).toBe(0)
      cache.set('AAPL', makeQuote('AAPL'))
      cache.set('GOOG', makeQuote('GOOG'))
      expect(cache.size).toBe(2)
    })

    it('clear removes everything', () => {
      cache.set('AAPL', makeQuote('AAPL'))
      cache.subscribe('AAPL')
      cache.clear()
      expect(cache.size).toBe(0)
      expect(cache.getSubscriptions()).toHaveLength(0)
    })
  })
})
