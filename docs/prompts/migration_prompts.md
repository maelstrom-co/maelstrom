# React migration prompts

## React migration playbook

The React migration material should be the flagship agent workflow because Maelstrom's React API is first-class and the framework's core promise is to orchestrate components developers already own.

A safe migration should be **incremental and reversible**, not “rewrite the app around Maelstrom.” The intended sequence is:

```plain
flowchart LR
    A[Baseline current app] --> B[Inventory components and state]
    B --> C[Choose low-risk pilot]
    C --> D[Extract Vessel state machine]
    D --> E[Adapt existing component]
    E --> F[Add Provider + Chart behind boundary]
    F --> G[Wire Actions and connector]
    G --> H[Parity tests]
    H --> I[Intent/E2E tests]
    I --> J[Feature-flagged rollout]
    J --> K{Healthy?}
    K -- Yes --> L[Migrate next slice]
    K -- No --> M[Disable flag / restore legacy route]
    M --> N[Diagnose without losing baseline]
```

### React migration prompt: repository inventory

```plain
Plan an incremental migration of this React application to Maelstrom.

Repository root:
[PATH]

Migration goal:
[GOAL — e.g. "make the analytics workspace intent-driven"]

Do not edit code during this pass.

Inspect:
- package.json and lockfile,
- React entry/root,
- router,
- primary screen/layout components,
- reusable leaf/domain components,
- state management,
- API/query layer,
- authentication,
- tests,
- error boundaries,
- telemetry,
- server/backend entrypoints.

Create an inventory with:
component | responsibility | states | interactions | side effects |
data source | coupling | suggested Vessel? | migration risk

Selection rules:
- Prefer a self-contained user-visible component as the first Vessel.
- Do not treat every React component as a Vessel.
- Prefer domain capabilities that make sense for intent-driven selection.
- Identify implementation-only components that should remain internal.
- Extract existing product behavior; do not invent new AI behavior.

Then propose migration stages in dependency order.

For every stage provide:
- files touched,
- expected behavior before/after,
- tests required,
- rollback mechanism,
- criteria for proceeding to the next stage.
```

This matters because a Vessel is not synonymous with a React component; it is the typed UI capability/state machine exposed to the Engine.

### React migration prompt: migrate one component

```plain
Migrate the following component to a Maelstrom Vessel while preserving its public
behavior and visual implementation as much as possible.

Primary component:
[PATH]

Call sites:
[PATHS OR "discover"]

Tests:
[PATHS OR "discover"]

Step 1 — behavior extraction
List every user-observable state, transition, operation and side effect with code evidence.

Step 2 — state-machine proposal
Map only meaningful states to Variants.
Map existing legal operations to Actions.
For each Action specify:
- params,
- transitionsTo,
- idempotent true/false with justification,
- handler/side effect owner.

Step 3 — description review
Write Vessel/Variant/Action descriptions as product capabilities.
Reject implementation-language descriptions such as
"this component calls hook X" unless that fact is operationally relevant.

Step 4 — implementation
Create:
- [name].vessel.ts
- [name].component.tsx or minimal adapter
- [name].actions.tsx if handlers are needed
- registration in the existing Maelstrom instance

Use TypeScript inference rather than broad any/casts.

Step 5 — tests
Run the old tests where applicable.
Add tests for each Variant and Action boundary.
Report any behavior that differs from the legacy implementation.

Do not delete the legacy route/component until the rollout stage explicitly authorizes it.
```

### React migration prompt: introduce the Maelstrom shell without a big-bang rewrite

```plain
Introduce Maelstrom into this React app incrementally.

Inputs:
Current root/layout: [PATH]
Registered pilot Vessel(s): [PATHS]
Engine connector config: [DETAILS]
Legacy screen: [PATH]
Feature flag or route strategy: [DETAILS OR "propose one"]

Requirements:
1. Create exactly one shared Maelstrom instance.
2. Register only the pilot Vessels initially.
3. Add Provider + Chart in a bounded route/screen/feature-flag branch.
4. Preserve the legacy UI path unchanged as rollback.
5. Add intent submission only inside the experimental path.
6. Surface connection/processing state.
7. Do not move provider credentials into the browser.
8. Keep unrelated routing and app providers intact.
9. Run full typecheck and existing tests.

Return:
- integration architecture,
- changed files,
- how the experimental and legacy paths coexist,
- enable/disable mechanism,
- rollback procedure.
```

The basic shell follows the official React flow of a shared `createMaelstrom()` instance, Provider, Chart, Connector and `processIntent()`.

A docs-ready example could show the transition from a fixed dashboard:

```typescript
// Before: application chooses the layout directly.
export function Dashboard() {
  return (
    <main className="dashboard-grid">
      <OrdersPanel />
      <InventoryPanel />
      <AlertsPanel />
    </main>
  );
}
```

to registered developer-owned capabilities:

```typescript
// src/vessels/orders/orders.vessel.ts
import { defineVessel } from '@maelstrom-co/protocol';

export const ordersVessel = defineVessel({
  id: 'orders',
  name: 'Orders',
  description:
    'Shows customer orders and lets the user move between a compact summary and detailed order information.',
  defaultVariant: 'summary',

  variants: {
    summary: {
      description: 'A compact overview of the currently relevant orders.',
      props: {
        count: 0 as number,
      },
      minSize: { width: 2, height: 2 },
      actions: [
        {
          name: 'expand',
          description: 'Show detailed order information.',
          transitionsTo: 'details',
          idempotent: true,
        },
      ],
    },

    details: {
      description: 'Detailed information for the relevant orders.',
      props: {
        count: 0 as number,
        selectedOrderId: '' as string,
      },
      minSize: { width: 4, height: 3 },
      actions: [
        {
          name: 'collapse',
          description: 'Return to the compact order overview.',
          transitionsTo: 'summary',
          idempotent: true,
        },
      ],
    },
  },
});
```

/

```typescript
// src/vessels/orders/orders.component.tsx
import type { TypedVesselProps } from '@maelstrom-co/react';
import { ordersVessel } from './orders.vessel';

export function OrdersVesselComponent({
  variantProps,
  executeAction,
}: TypedVesselProps<typeof ordersVessel>) {
  if (variantProps.variant === 'summary') {
    return (
      <OrdersPanel
        mode="summary"
        count={variantProps.count}
        onExpand={() => executeAction('expand')}
      />
    );
  }

  return (
    <OrdersPanel
      mode="details"
      count={variantProps.count}
      selectedOrderId={variantProps.selectedOrderId}
      onCollapse={() => executeAction('collapse')}
    />
  );
}
```

The syntax follows the documented pattern in which `TypedVesselProps` becomes a discriminated union over Variants and `executeAction` is type-aware. The example deliberately preserves the existing `OrdersPanel`: Maelstrom supplies the state-machine/orchestration boundary rather than forcing the developer to discard their component.

Then the shell:

```typescript
// src/maelstrom.ts
import { createMaelstrom, vessel } from '@maelstrom-co/react';
import { ordersVessel } from './vessels/orders/orders.vessel';
import { OrdersVesselComponent } from './vessels/orders/orders.component';

export const ordersEntry = vessel(ordersVessel, OrdersVesselComponent);

export const m = createMaelstrom({
  vessels: [ordersEntry],
});
```

```typescript
// src/MaelstromDashboard.tsx
import { WebSocketConnector } from '@maelstrom-co/react';
import { m } from './maelstrom';

const connector = new WebSocketConnector({
  url: import.meta.env.PUBLIC_MAELSTROM_WS_URL,
});

export function MaelstromDashboard() {
  return (
    <m.Provider
      connector={connector}
      onError={(error) => {
        reportError(error);
      }}
    >
      <m.Chart style={{ height: '100vh' }} />
    </m.Provider>
  );
}
```

This structure is adapted from Maelstrom's documented `vessel()`, `createMaelstrom()`, `WebSocketConnector`, Provider and Chart setup. Production deployments should continue to keep LLM provider credentials on the server.

### React migration prompt: actions and side effects

```plain
Audit the migrated Vessel Actions for correctness and side-effect safety.

Vessel:
[PATH]

For each Action produce:
action | active Variant | params | transitionsTo | side effect |
idempotent? | handler | validation | retry/duplicate risk

Checks:
1. An Action must represent behavior that already exists or is explicitly requested.
2. Action parameters should be as narrow and typed as practical.
3. transitionsTo should represent a real UI state transition.
4. Do not mark API writes, appends, increments, submissions, payments, deletes,
   or other accumulating/destructive effects idempotent unless the underlying
   product operation is genuinely idempotent and the implementation proves it.
5. Validate locally invoked Action values in app code where necessary.
6. Keep API/domain side effects in application handlers rather than the Connector.
7. Test failure results as well as success.
8. Identify any handler that should require an application-level confirmation.

Implement only after presenting the audit table.
```

The idempotence constraint is important because Maelstrom's Engine may encounter resize-triggered turns, and the documentation treats pure navigation differently from state-accumulating behavior. Local `executeAction` calls also remain the application's responsibility for value validation.

### React migration prompt: testing

```plain
Create a migration-parity test plan for this Maelstrom React slice.

Legacy implementation:
[PATH]

Maelstrom implementation:
[PATH]

Test stack:
[VITEST/JEST/RTL/PLAYWRIGHT/etc.]

Behavior contract:
[LIST OR "derive it from existing tests and implementation"]

Build three layers:

A. Deterministic component/state-machine tests
- render every Variant
- test legal Action invocation
- test Action handlers and error results
- validate important descriptions/definitions where useful

B. Deterministic layout/integration tests
- use programmatic layout only where a known layout is the thing under test
- verify actual instance IDs rather than inventing arbitrary ones
- do not use deterministic layout to mask poor Vessel descriptions

C. Intent-driven integration/E2E tests
- exercise processIntent for representative natural-language intents
- assert product outcomes/invariants rather than brittle exact coordinates where the
  model is allowed to choose layout
- record connector/processing errors on failure

Also run the legacy behavior suite against the migrated slice where practical.

Return:
test matrix | implementation | results | uncovered risks
```

Programmatic layout is explicitly recommended for cases such as tests where determinism matters, while ordinary intent-driven behavior should remain Engine-controlled. `instanceId` values used with layout/action APIs must refer to real client-created instances.

### React migration prompt: rollout and rollback

```plain
Prepare this Maelstrom migration for a reversible rollout.

Migrated route/feature:
[DETAILS]
Legacy route/component:
[DETAILS]
Release mechanism:
[FLAGS/ROUTER/DEPLOYMENTS]
Telemetry:
[DETAILS]

Requirements:
1. Keep the legacy implementation deployable during the initial rollout.
2. Add one explicit switch that restores the legacy path without source editing.
3. Pin the Maelstrom package version in the tested release.
4. Define health criteria:
   - connection failure rate
   - intent-processing failure rate
   - action-handler failures
   - render failures
   - key product-flow success
5. Define rollback triggers before deployment.
6. Verify that rollback does not require changing persisted product data.
7. Do not attempt to 'repair' bad Engine layouts by continuously overriding them
   programmatically.
8. Document how to revert package/lockfile changes.

Return:
- deployment sequence,
- health checks,
- rollback triggers,
- kill-switch procedure,
- data compatibility considerations,
- post-rollback diagnostics to retain.
```

Maelstrom recommends explicit error reporting and durable production boundaries, while its programmatic-layout guide warns against repeatedly overriding Engine decisions as a correction mechanism.