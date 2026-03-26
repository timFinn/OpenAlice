import type { OperationGuard, GuardRegistryEntry } from './types.js'
import { MaxPositionSizeGuard } from './max-position-size.js'
import { CooldownGuard } from './cooldown.js'
import { SymbolWhitelistGuard } from './symbol-whitelist.js'
import { MaxDailyLossGuard } from './max-daily-loss.js'
import { MaxDrawdownGuard } from './max-drawdown.js'
import { MaxOpenPositionsGuard } from './max-open-positions.js'
import { OrderRateLimitGuard } from './order-rate-limit.js'
import { MaxExposureGuard } from './max-exposure.js'

const builtinGuards: GuardRegistryEntry[] = [
  { type: 'max-position-size', create: (opts) => new MaxPositionSizeGuard(opts) },
  { type: 'cooldown',          create: (opts) => new CooldownGuard(opts) },
  { type: 'symbol-whitelist',  create: (opts) => new SymbolWhitelistGuard(opts) },
  { type: 'max-daily-loss',    create: (opts) => new MaxDailyLossGuard(opts) },
  { type: 'max-drawdown',      create: (opts) => new MaxDrawdownGuard(opts) },
  { type: 'max-open-positions', create: (opts) => new MaxOpenPositionsGuard(opts) },
  { type: 'order-rate-limit',  create: (opts) => new OrderRateLimitGuard(opts) },
  { type: 'max-exposure',      create: (opts) => new MaxExposureGuard(opts) },
]

const registry = new Map<string, GuardRegistryEntry['create']>(
  builtinGuards.map(g => [g.type, g.create]),
)

/** Register a custom guard type (for third-party extensions). */
export function registerGuard(entry: GuardRegistryEntry): void {
  registry.set(entry.type, entry.create)
}

/** Resolve config entries into guard instances via the registry. */
export function resolveGuards(
  configs: Array<{ type: string; options?: Record<string, unknown> }>,
): OperationGuard[] {
  const guards: OperationGuard[] = []
  for (const cfg of configs) {
    const factory = registry.get(cfg.type)
    if (!factory) {
      console.warn(`guard: unknown type "${cfg.type}", skipped`)
      continue
    }
    guards.push(factory(cfg.options ?? {}))
  }
  return guards
}
