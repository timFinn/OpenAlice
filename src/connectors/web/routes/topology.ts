import { Hono } from 'hono'
import type { EngineContext } from '../../../core/types.js'
import { AgentEventSchemas, EXTERNAL_EVENT_TYPES } from '../../../core/agent-event.js'

/**
 * Topology routes: GET /
 *
 * Returns the static shape of the agent's event-driven nervous system:
 * every known event type (with an `external` flag) + every registered
 * listener (with its subscribes set and declared emits). The frontend
 * uses this to render a DAG of Alice's async lifecycle.
 */
export function createTopologyRoutes(ctx: EngineContext) {
  const app = new Hono()

  app.get('/', (c) => {
    const eventTypes = Object.keys(AgentEventSchemas).map((name) => ({
      name,
      external: EXTERNAL_EVENT_TYPES.has(name as never),
    }))
    const listeners = ctx.listenerRegistry.list().map((l) => ({
      name: l.name,
      subscribes: [...l.subscribes],
      emits: [...l.emits],
    }))
    return c.json({ eventTypes, listeners })
  })

  return app
}
