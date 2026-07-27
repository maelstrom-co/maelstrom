/**
 * Type tests for ConnectionOptions.
 *
 * These assert compile-time facts a runtime test cannot: `ConnectionOptions`
 * is re-exported from `src/index.ts` (public API), so it appears verbatim in
 * consumers' `.d.ts`. `stabilityThresholdMs` must stay optional — making it
 * required would fail any external consumer holding a complete
 * `ConnectionOptions` value with "Property 'stabilityThresholdMs' is
 * missing" on the next version bump, and no runtime test in this repo would
 * ever notice because every in-repo consumer goes through
 * `Partial<ConnectionOptions>` already.
 *
 * Note: `nx typecheck` runs `tsc -p tsconfig.lib.json`, which excludes
 * `*.test.ts` files, so it does not exercise this file. Verify directly with
 * `tsc -p tsconfig.spec.json --noEmit` (mirrors the existing
 * action-runner.types.test.ts convention in this package).
 */

import { describe, it } from 'bun:test';

import type { ConnectionOptions } from './connection-manager.types.js';

describe('ConnectionOptions type', () => {
  it('is constructible without stabilityThresholdMs', () => {
    const _options: ConnectionOptions = {
      maxRetries: 5,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      circuitBreakerTimeoutMs: 60000,
      // stabilityThresholdMs intentionally omitted — must compile, or
      // adding it as a required field breaks every external consumer
      // holding a complete ConnectionOptions value.
    };
    void _options;
  });

  it('still accepts stabilityThresholdMs when a caller wants to override the default', () => {
    const _options: ConnectionOptions = {
      maxRetries: 5,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      circuitBreakerTimeoutMs: 60000,
      stabilityThresholdMs: 5000,
    };
    void _options;
  });
});
