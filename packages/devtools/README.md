# Maelstrom development diagnostics

The core package owns the collector, explicit content capture, JSON import/export,
and shared Solid panel. React applications install
[`@maelstrom-co/react-devtools`](../react-devtools/README.md). Other framework
adapters can attach the same collector before their client connects.

This framework-independent fragment shows the lifecycle seam:

```ts
import { createDevtools, mountDevtools } from '@maelstrom-co/devtools';

const tools = createDevtools();
const detach = tools.attach(orchestrator);
const unmount = mountDevtools(tools);

// When the application surface is removed:
unmount();
detach();
tools.dispose();
```

The caller supplies its existing Orchestrator. Mounting requires a browser DOM;
SSR mounting returns an inert cleanup. The collector does not connect clients
or execute Actions. Its metadata stream is separate from explicit content capture.

Application redaction policies should be idempotent. They run before retention
and again during export. The collector composes its policy with an existing
capture store's policy and redacts that store's retained notes and evidence.

## Inspect requests and recordings

Requests groups evidence by client lifetime and request ID. Response receipt,
client application, skipped Actions, and failures remain distinct. All events
keeps observations without a request association accessible. JSON accompanies
the readable summaries.

The request list, phase details, and JSON pane scroll independently. The JSON
pane defaults to a collapsible tree. Use Raw JSON for highlighted, copyable JSON.
Expand all and Collapse all control the tree. Switching presentations preserves
collapsed sections until the selected evidence changes.

Request history retains up to 1000 metadata events independently of the latest
100 events in All events. Configure these limits with `maxRequestEvents` and
`maxActivityEvents`. Request history evicts whole requests, so unrelated activity
does not remove their stages one at a time. A single request exceeding its limit
keeps its latest stages and reports partial evidence. Selection stays fixed until
you choose another request. If it expires, the panel asks you to select another.

Inspector projects layout geometry and registered capabilities. It labels its
diagram as schematic because container pixels are not retained. The optional
`setHighlightedInstance(clientId, instanceId)` capability highlights a live
Instance on its owning client. Clearing selection removes the highlight without
changing layout or executing Actions.

Recordings uses the existing Capture API and file format. Select a recording
scope, start, reproduce, and stop before inspecting supported content. Changing
an inspection filter does not change the active recording scope. Current and
imported recordings use the same request and Inspector views. Legacy captures
without app identity remain available through All events.

Custom recording readers can cache event projections by
`DiagnosticCapture.getEvidenceRevision()`. Redaction and evidence changes advance
that revision. Note edits update `getSnapshot().outcome` independently.

## Forward optional Engine evidence

Create one server helper per authorized connection. This server-side fragment
uses the application's existing Engine and send function:

```ts
import { createDiagnosticConnection } from '@maelstrom-co/engine';

const diagnostics = createDiagnosticConnection(engine, {
  enabled: process.env.NODE_ENV === 'development',
  sessionId: authorizedSessionId,
  send: frame => socket.send(frame),
  redact: value => redactApplicationData(value),
});

// In the existing frame handler:
const reply = await diagnostics.handle(rawFrame);
if (reply !== null) socket.send(reply);

// On connection close:
diagnostics.dispose();
```

The host supplies authentication and binds `authorizedSessionId` to the
connection. The WebSocket connector negotiates metadata and explicit-content
subscriptions automatically. Forwarding remains off without server opt-in and
is always disabled in production. The helper uses no browser package.
It forwards only requests received by this connection and stops forwarding when
each request completes. It tracks up to 128 concurrent requests for diagnostics.

The Engine reports planner attempts, validation, stage timing, and model usage
when the planner exposes it. Captures distinguish unknown data from observed
facts. HTTP and custom connectors retain local request diagnostics; server
forwarding requires a compatible subscription implementation.

Read the [DevTools guide](https://docs.maelstrom-ai.co/guides/devtools/) for
installation, request and voice inspection, recording, and production behavior.

## Enable browser diagnostics in every build

The default production entrypoint is inert. Import the explicit entrypoint to
enable collection, mounting, and explicit content capture in preview and production:

```ts
import { createDevtools, mountDevtools } from '@maelstrom-co/devtools/production';
```

Use the same attachment and cleanup sequence shown above. This entrypoint also
exports an enabled `DiagnosticCapture` and `VoiceDiagnostics` for applications
that supply their own stores. Retention limits and redaction still apply.
Content capture remains explicit. `enabled: false` disables the collector.
Production Engine forwarding remains disabled by its separate server policy.

## Update earlier DevTools previews

Replace the preview's `createDiagnosticPeer` and `DiagnosticCapture.liveWire`
instrumentation with the provider adapter's projected diagnostics feed. These
helpers are no longer exported by DevTools. React realtime forwards supported
provider evidence automatically; other consumers attach
`attachRealtimeDiagnostics` from `@maelstrom-co/realtime`.

New native observations use `voice.provider.*` and `providerGeneration`.
Session evidence uses `generation`. Connections keeps these scopes separate.
The optional prose-derived `snapshotRevision` field is no longer collected.
Existing recordings containing `live_wire` entries remain readable through both
supported capture formats.
