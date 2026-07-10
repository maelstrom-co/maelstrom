import type { ResolvedChartMotionConfig } from './chart/motion/motion-config.js';
import { DEFAULT_MOTION, resolveMotionConfig } from './chart/motion/motion-config.js';

/** Resolved config after merging factory defaults + Provider overrides */
export interface ResolvedMaelstromConfig {
  cellSizePx: number;
  tilingPaddingPx: number;
  debug: boolean;
  motion: ResolvedChartMotionConfig;
}

/** Default config values */
export const CONFIG_DEFAULTS = {
  cellSizePx: 80,
  tilingPaddingPx: 8,
  debug: false,
  motion: DEFAULT_MOTION,
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

  const tilingPaddingPx = provider.tilingPaddingPx ?? factory.tilingPaddingPx ?? CONFIG_DEFAULTS.tilingPaddingPx;
  if (tilingPaddingPx < 0) {
    throw new Error(`tilingPaddingPx must be non-negative, got ${tilingPaddingPx}`);
  }

  return {
    cellSizePx,
    tilingPaddingPx,
    debug: provider.debug ?? factory.debug ?? CONFIG_DEFAULTS.debug,
    motion: resolveMotionConfig(provider.motion ?? factory.motion),
  };
}
