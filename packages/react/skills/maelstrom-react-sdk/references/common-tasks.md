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

## Verify

Typecheck against this installation. Test the renderer and the scoped Provider
separately. Observe `connectionError`, `lastError`, and `lastResponse` through
`m.useMaelstrom()` when submitting intent. A resolved promise is not sufficient
evidence of success. Test real Engine selection separately from local rendering.

## Troubleshoot

- Missing `MaelstromProvider`: use the configured instance's `Provider`.
- Invalid first-screen seed: only tiling mode supports `initialLayout`; seeded
  Instances must name statically registered Vessels and legal Variants.
- Definition update conflict: retain the complete definition and the app's policy.
- Runtime source lookup: inspect `dist/index.js`. Declarations under `dist/lib/`
  do not imply separate runtime JavaScript files at those paths.
