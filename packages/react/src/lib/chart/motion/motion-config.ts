/**
 * Choreography settings for Chart layout changes. All motion honors
 * `prefers-reduced-motion: reduce` regardless of these values — the media
 * preference always wins over configuration.
 */
export interface ChartMotionConfig {
  /** Move/resize + enter/exit duration in ms. Default 350. */
  readonly durationMs?: number;
  /** CSS easing for all chart animations. Default 'cubic-bezier(0.22, 1, 0.36, 1)'. */
  readonly easing?: string;
  /** Per-vessel delay in reading order for enter/move waves. Default 30. */
  readonly staggerMs?: number;
  /** Disables all chart motion when true. Default false. */
  readonly disabled?: boolean;
}

export interface ResolvedChartMotionConfig {
  readonly durationMs: number;
  readonly easing: string;
  readonly staggerMs: number;
  readonly disabled: boolean;
}

// Slack added on top of durationMs before an exit ghost's DOM node is torn
// down, so the exit-fade animation always finishes before its node
// disappears.
export const EXIT_CLEANUP_BUFFER_MS = 100;

export const DEFAULT_MOTION: ResolvedChartMotionConfig = {
  durationMs: 350,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  staggerMs: 30,
  disabled: false,
};

export function resolveMotionConfig(config: ChartMotionConfig | undefined): ResolvedChartMotionConfig {
  // `< 0` alone lets NaN through (`NaN < 0` is false), which then reaches
  // `node.animate({ duration: NaN })` and throws an opaque "non-finite
  // duration" at animation time instead of here at config setup.
  const durationMs = config?.durationMs ?? DEFAULT_MOTION.durationMs;
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error(`durationMs must be a non-negative finite number, got ${durationMs}`);
  }

  const staggerMs = config?.staggerMs ?? DEFAULT_MOTION.staggerMs;
  if (!Number.isFinite(staggerMs) || staggerMs < 0) {
    throw new Error(`staggerMs must be a non-negative finite number, got ${staggerMs}`);
  }

  return {
    durationMs,
    easing: config?.easing ?? DEFAULT_MOTION.easing,
    staggerMs,
    disabled: config?.disabled ?? DEFAULT_MOTION.disabled,
  };
}

/** True when motion must not run: disabled by config or by the user's OS preference. */
export function motionSuppressed(resolved: ResolvedChartMotionConfig): boolean {
  if (resolved.disabled) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
