/**
 * QuoteCache — broker-agnostic quote caching with staleness threshold.
 *
 * Populated by websocket callbacks, queried by getQuote().
 * Falls back to a REST fetcher when cache is stale or missing.
 * The cache doesn't know about websockets — brokers are responsible
 * for calling set() from their streaming callbacks.
 */

import type { Quote } from './brokers/types.js'

const DEFAULT_STALENESS_MS = 5_000

interface CacheEntry {
  quote: Quote
  receivedAt: number
}

export class QuoteCache {
  private cache = new Map<string, CacheEntry>()
  private subscriptions = new Set<string>()
  private stalenessMs: number

  constructor(stalenessMs = DEFAULT_STALENESS_MS) {
    this.stalenessMs = stalenessMs
  }

  /** Get a cached quote if it exists and is fresh. Returns null if stale or missing. */
  get(symbol: string): Quote | null {
    const entry = this.cache.get(symbol)
    if (!entry) return null
    if (Date.now() - entry.receivedAt > this.stalenessMs) return null
    return entry.quote
  }

  /** Store a quote in the cache. Called by websocket callbacks. */
  set(symbol: string, quote: Quote): void {
    this.cache.set(symbol, { quote, receivedAt: Date.now() })
  }

  /**
   * Cache-first quote access with REST fallback.
   * If a fresh cached quote exists, returns it immediately.
   * Otherwise calls the fetcher (REST) and caches the result.
   */
  async getOrFetch(symbol: string, fetcher: () => Promise<Quote>): Promise<Quote> {
    const cached = this.get(symbol)
    if (cached) return cached

    const quote = await fetcher()
    this.set(symbol, quote)
    return quote
  }

  /** Mark a symbol for streaming subscription. Brokers check this to know what to subscribe. */
  subscribe(symbol: string): void {
    this.subscriptions.add(symbol)
  }

  /** Get all symbols that should be actively streamed. */
  getSubscriptions(): string[] {
    return [...this.subscriptions]
  }

  /** Check if a symbol has a cached entry (fresh or stale). */
  has(symbol: string): boolean {
    return this.cache.has(symbol)
  }

  /** Number of cached entries. */
  get size(): number {
    return this.cache.size
  }

  /** Clear all cached quotes and subscriptions. */
  clear(): void {
    this.cache.clear()
    this.subscriptions.clear()
  }
}
