/**
 * Type tests for MaelstromInstance.useActions inference.
 *
 * Verifies that callback params are inferred through the full generic chain:
 *   MaelstromInstance<T> → ActionRunnerLookup<T>[Id] → ActionRunner<V>
 * This chain previously resolved to `any` in tsc --build mode.
 *
 * Run `nx typecheck @maelstrom-co/react` to verify these tests.
 */

import { describe, it } from 'bun:test';

import { defineVessel } from '@maelstrom-co/protocol';
import { ok } from '@maelstrom-co/protocol';

import type { MaelstromInstance } from './maelstrom-instance-types.js';
import { vessel } from './vessel.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';

// ============================================================================
// Test fixture: multi-vessel MaelstromInstance
// ============================================================================

const weatherDef = defineVessel({
  id: 'weather',
  name: 'Weather',
  description: 'Weather vessel',
  defaultVariant: 'compact',
  variants: {
    compact: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [],
    },
  },
});

const ordersEntry = vessel(testVessel, () => null);
const weatherEntry = vessel(weatherDef, () => null);

type TestEntries = readonly [typeof ordersEntry, typeof weatherEntry];

// Type-only instance — guarded so calls are never executed at runtime.
// TypeScript still type-checks all code paths inside the guard.
declare const m: MaelstromInstance<TestEntries>;
const TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME = false as boolean;

// ============================================================================
// Tests — compile-time only (bodies are unreachable at runtime)
// ============================================================================

describe('MaelstromInstance.useActions inference', () => {
  it('infers typed params for parameterized actions', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      // biome-ignore lint/correctness/useHookAtTopLevel: type-level assertion only — this it() body never executes (guarded by a statically-false flag), it exists purely so tsc checks the call's inferred types.
      m.useActions('orders', 'inst-1', {
        selectOrder: async (params) => {
          const _id: string = params.orderId;
          void _id;
          return ok(undefined);
        },
      });
    }
  });

  it('infers typed params from destructured arguments', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      // biome-ignore lint/correctness/useHookAtTopLevel: type-level assertion only — never executes at runtime, see comment above the first test in this file.
      m.useActions('orders', 'inst-1', {
        selectOrder: async ({ orderId }) => {
          const _id: string = orderId;
          void _id;
          return ok(undefined);
        },
      });
    }
  });

  it('allows parameterless actions as zero-arg handlers', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      // biome-ignore lint/correctness/useHookAtTopLevel: type-level assertion only — never executes at runtime, see comment above the first test in this file.
      m.useActions('orders', 'inst-1', {
        refresh: async () => ok(undefined),
        close: async () => ok(undefined),
      });
    }
  });

  it('rejects unknown action names in runner', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      // biome-ignore lint/correctness/useHookAtTopLevel: type-level assertion only — never executes at runtime, see comment above the first test in this file.
      m.useActions('orders', 'inst-1', {
        // @ts-expect-error - 'bogus' is not an action on the orders vessel
        bogus: async () => ok(undefined),
      });
    }
  });

  it('rejects wrong vessel ID', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      // @ts-expect-error - 'nope' is not a registered vessel ID
      // biome-ignore lint/correctness/useHookAtTopLevel: type-level assertion only — never executes at runtime, see comment above the first test in this file.
      m.useActions('nope', 'inst-1', {});
    }
  });
});
