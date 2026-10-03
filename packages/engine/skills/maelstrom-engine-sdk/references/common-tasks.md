# Wire a planner with explicit local history

The host supplies the planner and owns provider credentials. This fragment uses
an in-memory store for local work; it is not a production persistence policy.

```ts
import { createEngine, createInMemoryStore, type Planner } from '@maelstrom-co/engine';

export function createLocalEngine(planner: Planner) {
  return createEngine({
    planner,
    retry: false,
    history: { store: createInMemoryStore(), maxEntries: 32 },
  });
}
```

Choose retention bounds from application policy. A production host must authorize
tenant/session access, redact persisted content, and provide durable coordination.
Keep provider-specific planner implementations in their owning packages.

## Verify

Exercise valid requests, invalid definitions, planner failure, cancellation, and
history failure with deterministic planner/store seams. Inspect the Result returned
by processing. A renderable healed layout and an unrecoverable failure differ.

## Troubleshoot

History requires an explicit store. In-memory history disappears on restart and
does not coordinate multiple hosts. Retry policy does not serialize distinct
requests for the same session. Confirm a failure surface before changing prompts.
