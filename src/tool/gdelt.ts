/**
 * GDELT News Intelligence Tool
 *
 * Queries the GDELT DOC 2.0 API for global event-driven news.
 * GDELT monitors broadcast, print, and web news from nearly every country,
 * translated into English, and updated every 15 minutes.
 *
 * This provides a fundamentally different signal than financial media RSS:
 * geopolitical events, sanctions, conflicts, central bank actions, and
 * economic disruptions often appear in GDELT before they hit CNBC.
 *
 * No API key required. Public API at api.gdeltproject.org.
 */

import { tool } from 'ai'
import { z } from 'zod'

const GDELT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc'
const FETCH_TIMEOUT = 15_000

// Pre-built topic queries matching the pliny feed-server categories
const TOPIC_QUERIES: Record<string, string> = {
  financial: '"federal reserve" OR "interest rates" OR "bank failure" OR "economic recession" OR "inflation data" OR "housing market crash"',
  geopolitical: 'geopolitics OR "international relations" OR sanctions OR "trade war" OR "diplomatic crisis" OR "border conflict"',
  defense: '"defense procurement" OR "space launch" OR "missile defense" OR "military exercise" OR "arms deal"',
  cyber: 'cybersecurity OR "data breach" OR ransomware OR "critical infrastructure attack" OR "state-sponsored hacking"',
  energy: '"oil price" OR "OPEC" OR "natural gas" OR "energy crisis" OR "pipeline" OR "energy sanctions"',
}

interface GDELTArticle {
  url: string
  url_mobile: string
  title: string
  seendate: string
  socialimage: string
  domain: string
  language: string
  sourcecountry: string
}

interface GDELTResponse {
  articles?: GDELTArticle[]
}

async function queryGDELT(
  query: string,
  opts: { mode?: string; maxrecords?: number; timespan?: string },
): Promise<GDELTArticle[]> {
  const params = new URLSearchParams({
    query,
    mode: opts.mode ?? 'ArtList',
    maxrecords: String(opts.maxrecords ?? 25),
    format: 'json',
    sort: 'DateDesc',
  })
  if (opts.timespan) params.set('timespan', opts.timespan)

  const res = await fetch(`${GDELT_DOC_API}?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  if (!res.ok) throw new Error(`GDELT API: ${res.status} ${res.statusText}`)
  const data = await res.json() as GDELTResponse
  return data.articles ?? []
}

export function createGDELTTools() {
  return {
    gdeltNews: tool({
      description: `Query GDELT for global event-driven news intelligence.

GDELT monitors news from nearly every country in 65 languages, translated to English,
updated every 15 minutes. This surfaces geopolitical, economic, and security events
that mainstream financial media may not cover or may cover late.

Pre-built topics for trading relevance:
- "financial" — Fed, interest rates, bank failures, recession signals, inflation
- "geopolitical" — sanctions, trade wars, diplomatic crises, border conflicts
- "defense" — military procurement, arms deals, missile tests, space launches
- "cyber" — data breaches, ransomware, infrastructure attacks, state hacking
- "energy" — oil/gas prices, OPEC, pipeline disruptions, energy sanctions

Or use a custom query for any topic. Supports boolean operators (OR, AND, NOT).

Examples:
  gdeltNews({ topic: "financial" })
  gdeltNews({ topic: "geopolitical", timespan: "1h" })
  gdeltNews({ customQuery: "tariff AND China AND semiconductor" })
  gdeltNews({ customQuery: '"interest rate cut" OR "rate decision"', limit: 10 })`,
      inputSchema: z.object({
        topic: z.enum(['financial', 'geopolitical', 'defense', 'cyber', 'energy']).optional()
          .describe('Pre-built topic query. Use this for broad monitoring.'),
        customQuery: z.string().optional()
          .describe('Custom GDELT query with boolean operators. Use this for specific events.'),
        timespan: z.string().optional()
          .describe('Lookback period: "15min", "1h", "6h", "24h", "7d" (default: "24h")'),
        limit: z.number().int().positive().optional()
          .describe('Max articles (default: 25, max: 75)'),
      }),
      execute: async ({ topic, customQuery, timespan, limit }) => {
        if (!topic && !customQuery) {
          return { error: 'Provide either a topic or customQuery.' }
        }

        const query = customQuery ?? TOPIC_QUERIES[topic!]
        const articles = await queryGDELT(query, {
          maxrecords: Math.min(limit ?? 25, 75),
          timespan: timespan ?? '24h',
        })

        if (articles.length === 0) {
          return { query: topic ?? customQuery, articlesFound: 0, message: 'No matching articles in the timeframe.' }
        }

        return {
          query: topic ?? 'custom',
          timespan: timespan ?? '24h',
          articlesFound: articles.length,
          articles: articles.map(a => ({
            title: a.title,
            source: a.domain,
            country: a.sourcecountry,
            time: a.seendate,
            url: a.url,
          })),
        }
      },
    }),
  }
}
