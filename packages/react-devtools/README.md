# Add Maelstrom devtools to React

Install the React adapter alongside an application using `@maelstrom-co/react`.
Install packages from npm without a GitHub token.

Read the [DevTools guide](https://docs.maelstrom-ai.co/guides/devtools/) for the
installation and recording workflow.

```sh
bun add @maelstrom-co/react-devtools
```

Apply the extension to your configured instance. This fragment uses your existing
Vessel entries and Engine connector:

```tsx
import { createMaelstrom } from '@maelstrom-co/react';
import { devtools } from '@maelstrom-co/react-devtools';

const m = createMaelstrom({ vessels }).with(devtools());

<m.Provider connector={connector}>
  <m.Chart />
  <m.Devtools />
</m.Provider>;
```

Open the floating Maelstrom button during development. Requests groups live
metadata by app lifetime and request ID. Select a request and an observed stage
to read its outcome beside the JSON. All events includes voice, connection, and
uncorrelated observations.

Inspector shows a schematic Chart and the selected Instance's Variant and
registered Actions. Selecting a live Instance highlights its owning Chart.
Connections separates app lifetimes, Engine connection state, and voice evidence.

To inspect delivery from existing application telemetry, pass
`devtools({ telemetry })`. The shared Telemetry tab reads local counters while
visible. See [telemetry delivery](../devtools/README.md#inspect-telemetry-delivery)
for ownership, refresh, and recording boundaries.

Each mounted Provider creates an app instance. The App instance selector filters
inspection; ended instances can remain as retained history. Voice providers are
separate. The selector is hidden when only one app identity is present.

To preserve a problem, open Recordings and choose its recording scope. Start
recording, reproduce the problem, then Stop. Inspect recording opens the same
readable views with retained content. Add a note or choose Export JSON. Clear
recording removes that recording without clearing live activity. Open recording
loads a file as read-only evidence. The Evidence selector switches between live
activity, the current recording, and an imported recording.

Recording scope stays fixed after Start. All app instances includes clients
attached later. A selected-app recording stops when that app lifetime ends.
Earlier prompts and arguments cannot be recovered after recording starts.

Place `m.Devtools` outside a conditional Provider when retained evidence must
remain accessible after that Provider unmounts. Multiple mounts share one panel.

Configure limits and application redaction through the extension:

```tsx
const m = createMaelstrom({ vessels }).with(devtools({
  position: 'bottom-left',
  theme: 'dark',
  maxActivityEvents: 250,
  capture: { maxEvents: 2000, maxCharacters: 4000000 },
  redact: value => redactApplicationData(value),
}));
```

`redactApplicationData` is application-owned. It receives detached data and
returns the representation that may be retained. Defaults remove common
credential fields and patterns. Configure additional redaction for your data.

The adapter shares its collector across Provider lifetimes from this configured
instance. It retains bounded evidence after remounts, with separate client
identities. A page reload clears the in-memory store.

The default production entrypoint attaches no observers and renders no tools. Source consumers
must replace `process.env.NODE_ENV` at build time, as Vite does. Server traces
require an explicit host integration; see the [core package](../devtools/README.md).

## Enable tools in preview and production

Use the explicit entrypoint when your application should expose its inspector
in every build. The demo uses this entrypoint:

```tsx
import { devtools } from '@maelstrom-co/react-devtools/production';
```

Apply it with the same `.with(devtools())` call and mount `m.Devtools`.
`enabled: false` still disables observation and mounting. Content still requires
Start recording. This browser opt-in does not enable production Engine forwarding.
If you supply a capture store, create it from `@maelstrom-co/devtools/production`.
