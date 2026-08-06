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
import { defineVessel, ok } from '@maelstrom-co/protocol';
import {
  type TestVessel,
  testVessel,
} from './__tests__/test-vessel.fixture.js';
import type { DynamicVesselHandle } from './dynamic-vessel-types.js';
import type { MaelstromInstance } from './maelstrom-instance-types.js';
import { vessel } from './vessel.js';

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
// Type-only handle, standing in for what `m.registerVessel(entry)` returns
// for a vessel registered only at runtime — decoupled from `TestEntries`
// on purpose, since `DynamicVesselHandle<V>` is generic over `V` alone.
declare const dynamicHandle: DynamicVesselHandle<TestVessel>;
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

describe('MaelstromInstance.updateVessel inference', () => {
  it('typechecks the documented @example (Object.fromEntries enum rebuild)', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      const orderIds = ['ord-1', 'ord-2'];
      // Copied from the updateVessel JSDoc @example, with journalVessel/title
      // swapped for this file's testVessel/orderId. This is criterion 1 —
      // the case most likely to break, since Object.fromEntries returns a
      // plain index-signature type with no named variant keys at all.
      m.updateVessel({
        ...testVessel,
        variants: Object.fromEntries(
          Object.entries(testVessel.variants).map(([variantName, variant]) => [
            variantName,
            {
              ...variant,
              actions: variant.actions.map((action) =>
                action.name === 'selectOrder' && action.parameters
                  ? {
                      ...action,
                      parameters: action.parameters.map((parameter) =>
                        parameter.name === 'orderId'
                          ? { ...parameter, enum: orderIds }
                          : parameter,
                      ),
                    }
                  : action,
              ),
            },
          ]),
        ),
      });
    }
  });

  it('typechecks changing an action enum via a plain per-variant object literal', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      // The primary use case (criterion 2), written without Object.fromEntries
      // to prove the named-literal path works too, not just the documented idiom.
      m.updateVessel({
        ...testVessel,
        variants: {
          list: {
            ...testVessel.variants.list,
            actions: [
              {
                name: 'selectOrder',
                description: 'Select an order',
                parameters: [
                  {
                    name: 'orderId',
                    type: 'string' as const,
                    description: 'Order ID',
                    required: true,
                    enum: ['ord-1', 'ord-2'],
                  },
                ],
              },
              { name: 'refresh', description: 'Refresh list' },
            ],
          },
          detail: testVessel.variants.detail,
        },
      });
    }
  });

  it('rejects a variant whose props drop a field the registered entry declares', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      // Criterion 3 — the bug this fix closes. testVessel's 'list' variant
      // declares props { view, pageSize }; dropping 'pageSize' must fail,
      // because that shape matches neither 'list' nor 'detail' on 'orders'.
      m.updateVessel({
        ...testVessel,
        variants: {
          list: {
            // @ts-expect-error - drops 'pageSize', which the registered 'list' variant declares
            props: { view: 'list' },
            minSize: { width: 2, height: 2 },
            actions: [],
          },
          detail: testVessel.variants.detail,
        },
      });
    }
  });

  it('rejects a mistyped id outside VesselIds<T> at compile time', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      // Id is constrained to VesselIds<T>, so an id T does not know about —
      // whether a plain typo or one only ever registered at runtime via
      // registerVessel() — must fail to compile instead of silently
      // widening to an unchecked VesselDefinition. The registerVessel()
      // runtime path gets its own typed door instead: handle.update() on
      // the handle registerVessel() returns, checked below.
      // @ts-expect-error - 'nope' is not a member of VesselIds<T>
      m.updateVessel({ ...testVessel, id: 'nope' });
    }
  });

  it('still compiles for a valid, statically-declared id', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      m.updateVessel({ ...testVessel, id: 'orders' });
    }
  });
});

describe('DynamicVesselHandle.update inference', () => {
  it('accepts a definition matching the registered vessel', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      // V is inferred exactly at the registerVessel() call site, so
      // handle.update() gets the same props-shape check m.updateVessel()
      // gives a statically-declared id — just checked against V instead of
      // ExtractVesselByIdFromEntries<T, Id>.
      dynamicHandle.update({
        ...testVessel,
        variants: {
          list: { ...testVessel.variants.list, actions: [] },
          detail: testVessel.variants.detail,
        },
      });
    }
  });

  it('rejects a variant whose props match no variant on the registered vessel', () => {
    if (TYPECHECK_ONLY_WILL_THROW_AT_RUNTIME) {
      // Mirrors the m.updateVessel() "drops a field" criterion above: a
      // props shape matching neither 'list' nor 'detail' on 'orders' must
      // fail to compile through handle.update() too.
      dynamicHandle.update({
        ...testVessel,
        variants: {
          list: {
            // @ts-expect-error - drops 'pageSize', which the registered 'list' variant declares
            props: { view: 'list' },
            minSize: { width: 2, height: 2 },
            actions: [],
          },
          detail: testVessel.variants.detail,
        },
      });
    }
  });
});
