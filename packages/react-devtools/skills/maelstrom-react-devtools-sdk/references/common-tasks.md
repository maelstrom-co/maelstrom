# Inspect a React Chart

Apply the extension to a typed instance. Supply the application's configured
connector. Keep the panel outside the Provider if that Provider can unmount.

```tsx
import type { EngineConnector } from '@maelstrom-co/client';
import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import { devtools } from '@maelstrom-co/react-devtools';

const status = defineVessel({
  id: 'status',
  name: 'Status',
  description: 'Show application status',
  defaultVariant: 'summary',
  variants: {
    summary: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
  },
});

function Status() {
  return <section aria-label="Application status">Ready</section>;
}

const m = createMaelstrom({ vessels: [vessel(status, Status)] })
  .with(devtools({ position: 'bottom-right' }));

export function StatusChart({ connector }: { connector: EngineConnector }) {
  return (
    <>
      <m.Provider connector={connector}><m.Chart /></m.Provider>
      <m.Devtools />
    </>
  );
}
```

## Verify

Open Requests in a development build. Submit a deterministic intent and inspect
the correlated layout and Action results beside the JSON. Use All events for
lower-level observations. Inspector highlights only its owning live app instance.
Start and stop a recording with its separate scope control, then remount
the Provider. Confirm the note and export remain available. Verify production
builds using the default entrypoint mount no panel or diagnostic observers.
For an application that deliberately exposes tools in preview and production,
import `devtools` from `@maelstrom-co/react-devtools/production` and verify the
same capture flow in its production build. Supply custom capture stores from
`@maelstrom-co/devtools/production`.

## Troubleshoot

- Empty panel: install the extension on the same configured instance as the Chart.
- Lost access after unmount: render `m.Devtools` outside the conditional Provider.
- Hidden content: automatic activity is metadata-only; start capture explicitly.
- App instance: one Provider lifetime; voice providers are shown in Connections.
- Recording scope: fixed at Start recording, independent of inspection filters.
- Duplicate mounts: the shared panel remains until its last mount releases it.
- Test rendering: the default adapter enables UI in development; `/production` enables every build.
