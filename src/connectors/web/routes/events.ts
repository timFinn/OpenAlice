import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { EngineContext } from '../../../core/types.js'
import type { AgentEventMap } from '../../../core/agent-event.js'
import { isExternalEventType, validateEventPayload } from '../../../core/agent-event.js'

/** Event log routes: GET /, GET /recent, GET /stream (SSE), POST /ingest */
export function createEventsRoutes(ctx: EngineContext) {
  const app = new Hono()

  // Ingest external events — webhook / API producer surface.
  //
  // Body shape: { type: string, payload: unknown }
  // Only event types in EXTERNAL_EVENT_TYPES are accepted — prevents external
  // actors from forging internal state transitions like `cron.done`.
  //
  // Auth: none for v1 (localhost-only). Gate behind a reverse proxy / add a
  // token check before exposing publicly.
  app.post('/ingest', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as { type?: unknown }).type !== 'string'
    ) {
      return c.json({ error: 'Body must be { type: string, payload: ... }' }, 400)
    }

    const { type, payload } = body as { type: string; payload: unknown }

    if (!isExternalEventType(type)) {
      return c.json(
        { error: `Event type '${type}' is not in the external allowlist` },
        403,
      )
    }

    try {
      validateEventPayload(type, payload)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 400)
    }

    const entry = await ctx.eventLog.append(
      type as keyof AgentEventMap,
      payload as AgentEventMap[keyof AgentEventMap],
    )
    return c.json(entry, 201)
  })

  // Paginated query from disk (full history)
  app.get('/', async (c) => {
    const page = Number(c.req.query('page')) || 1
    const pageSize = Number(c.req.query('pageSize')) || 100
    const type = c.req.query('type') || undefined
    const result = await ctx.eventLog.query({ page, pageSize, type })
    return c.json(result)
  })

  // Fast in-memory query (ring buffer)
  app.get('/recent', (c) => {
    const afterSeq = Number(c.req.query('afterSeq')) || 0
    const limit = Number(c.req.query('limit')) || 100
    const type = c.req.query('type') || undefined
    const entries = ctx.eventLog.recent({ afterSeq, limit, type })
    return c.json({ entries, lastSeq: ctx.eventLog.lastSeq() })
  })

  app.get('/stream', (c) => {
    return streamSSE(c, async (stream) => {
      const unsub = ctx.eventLog.subscribe((entry) => {
        stream.writeSSE({ data: JSON.stringify(entry) }).catch(() => {})
      })

      const pingInterval = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '' }).catch(() => {})
      }, 30_000)

      stream.onAbort(() => {
        clearInterval(pingInterval)
        unsub()
      })

      await new Promise<void>(() => {})
    })
  })

  return app
}
