/** Resolved config after merging factory defaults + Provider overrides */
export interface ResolvedMaelstromConfig {
  cellSizePx: number;
  debug: boolean;
}

/** Default config values */
export const CONFIG_DEFAULTS = {
  cellSizePx: 80,
  debug: false,
} as const satisfies ResolvedMaelstromConfig;

/** Resolve config with priority: provider overrides > factory defaults > hardcoded defaults */
export function resolveConfig(
  factory: Partial<ResolvedMaelstromConfig>,
  provider: Partial<ResolvedMaelstromConfig>,
): ResolvedMaelstromConfig {
  const cellSizePx = provider.cellSizePx ?? factory.cellSizePx ?? CONFIG_DEFAULTS.cellSizePx;
  if (cellSizePx <= 0) {
    throw new Error(`cellSizePx must be positive, got ${cellSizePx}`);
  }

  return {
    cellSizePx,
    debug: provider.debug ?? factory.debug ?? CONFIG_DEFAULTS.debug,
  };
}
