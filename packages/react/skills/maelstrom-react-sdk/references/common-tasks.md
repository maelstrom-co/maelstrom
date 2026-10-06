# Register a read-only capability

Inspect the existing renderer and its data owner first. Keep incidental controls
inside the capability. This example registers one Variant without Actions; its
one-cell minimum is illustrative, not a measurement of your application's UI.

```tsx
import type { EngineConnector } from '@maelstrom-co/client';
import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';

const status = defineVessel({
  id: 'status',
  name: 'Status',
  description: 'Show the application status',
  defaultVariant: 'summary',
  variants: {
    summary: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
  },
});

function Status() {
  return <section aria-label="Application status">Ready</section>;
}

export const m = createMaelstrom({ vessels: [vessel(status, Status)] });

export function StatusChart({ connector }: { connector: EngineConnector }) {
  return <m.Provider connector={connector}><m.Chart /></m.Provider>;
}
```

Create the instance outside component rendering. Supply your application's
configured Connector. The instance owns `Provider` and `Chart`; these are not
standalone named package exports. Preserve a legacy path when migrating.

For Actions, keep authorization, confirmation, and effects in application-owned
handlers. For definition changes, preserve every existing Variant and Action;
inspect the returned update conflicts before deciding how to proceed.

## Seed a tiling first screen

Use this branch when a registered capability must appear before the first Engine
response. Keep the configured Connector and scope the Provider to the migrated
surface. Register the existing renderer statically; the Engine arranges Instances
of that renderer rather than generating runtime JSX.
Mount this surface in the application's sized Chart container.

```tsx
import type { EngineConnector } from '@maelstrom-co/client';
import {
  InstanceId,
  type TilingLayout,
  VariantName,
  VesselId,
  tilingLeafToken,
} from '@maelstrom-co/protocol';
import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';

const status = defineVessel({
  id: 'status',
  name: 'Status',
  description: 'Show the application status',
  defaultVariant: 'summary',
  variants: {
    summary: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
  },
});

function Status() {
  return <section aria-label="Application status">Ready</section>;
}

const m = createMaelstrom({ vessels: [vessel(status, Status)] });
const instanceId = InstanceId('status-main');
const initialLayout: TilingLayout = {
  type: 'tiling',
  tree: [tilingLeafToken(instanceId)],
  instances: [{
    instanceId,
    vesselId: VesselId('status'),
    variant: VariantName('summary'),
  }],
};

export function SeededStatusChart({ connector }: { connector: EngineConnector }) {
  return (
    <m.Provider connector={connector} layoutMode="tiling" initialLayout={initialLayout}>
      <m.Chart />
    </m.Provider>
  );
}
```

Match each leaf to one seeded Instance, and each Instance to a registered Vessel
and declared Variant. `initialLayout` is captured on mount; use a new Provider
session when you need a different seed. Keep application data and effects with
their existing owners.

## Verify

Typecheck against this installation. Test the renderer and the scoped Provider
separately. Observe `connectionError`, `lastError`, and `lastResponse` through
`m.useMaelstrom()` when submitting intent. A resolved promise is not sufficient
evidence of success. Test real Engine selection separately from local rendering.

### Test Chart in a DOM

Before mounting `m.Chart`, configure the runner's DOM environment and provide
`ResizeObserver` in the test setup. jsdom does not supply layout or
`ResizeObserver`. For sizing or resize assertions, use a real browser with a
sized Chart container, or a controlled observer that emits meaningful container
`contentRect` dimensions. Verify the measured geometry as part of that test.
An inert test-only observer can support control or error tests; label their
layout behavior unverified. Keep that substitute in test setup and restore any
replaced globals during teardown.

For an intent-failure regression, inject a local test Connector that connects
successfully and rejects `process` with a known error. Render a probe inside the
same instance's Provider. Give it a button disabled until
`connectionStatus === 'connected'` and while `isProcessing`, and display
`connectionError` and `lastError` from that same `m.useMaelstrom()` call.

1. Register `afterEach` cleanup to unmount the rendered tree and restore test
   observers, mocks, and timers, including when an assertion fails.
2. Use a bounded asynchronous assertion to wait for the connected state and the
   enabled button before clicking. Treat a disabled button as a pending
   precondition, rather than skipping the click.
3. Click once, then use a bounded asynchronous assertion to check the known
   `lastError` and that processing ends. A resolved `processIntent` promise
   alone does not distinguish success from failure.
4. For success tests, observe `lastResponse`, a clear `lastError`, and the
   expected rendered capability. Include meaningful geometry when claiming
   layout correctness.

With Testing Library, use `waitFor` with an explicit timeout, such as 1000 ms,
and an assertion that throws until the expected state appears. Let waits yield
to DOM updates and timers so a missing error fails within the bound.

## Troubleshoot

- Missing `MaelstromProvider`: use the configured instance's `Provider`.
- Invalid first-screen seed: only tiling mode supports `initialLayout`; seeded
  Instances must name statically registered Vessels and legal Variants.
- Definition update conflict: retain the complete definition and the app's policy.
- Runtime source lookup: inspect `dist/index.js`. Declarations under `dist/lib/`
  do not imply separate runtime JavaScript files at those paths.
