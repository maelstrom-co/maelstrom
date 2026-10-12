# @maelstrom-co/telemetry

Operational telemetry contracts and bounded delivery for browser and server
applications. The package has no runtime dependencies. Applications own their
telemetry SDK, exporter, destination, and retention policy.

The package does not attach to the client, Engine, or voice session. Producers
submit selected facts through `record`. `projectDiagnosticMetadata` translates
an explicit allowlist of existing metadata without subscribing to diagnostics.
Automatic producer attachment and detailed traces are outside this API.

## Export records

This complete TypeScript example runs with Bun after package installation:

```ts
import {
  createTelemetry,
  type TelemetryRecord,
} from '@maelstrom-co/telemetry';

const exported: TelemetryRecord[] = [];
const telemetry = createTelemetry({
  sink(batch) {
    exported.push(...batch);
  },
});

telemetry.record({
  operation: 'client.action',
  outcome: 'succeeded',
  durationMs: 12,
});

const result = await telemetry.flush();
console.log({ outcome: result.outcome, delivered: result.snapshot.delivered });
telemetry.dispose();
```

Expected output: `{ outcome: "settled", delivered: 1 }`.

Each record contains a counter observation and, when known, a duration histogram
observation in milliseconds. The record's attributes contain only the fixed
operation, outcome, provider category, error category, and layout mode fields.
Started and terminal outcomes are separate series. Nested Engine stages are
separate from whole planning durations.

Export every counter and histogram observation before applying any downstream
trace sampling. Delivery is best effort: inspect `getSnapshot().dropped` to
account for facts that never reach the sink. Unknown duration stays absent.
Request and session identifiers have no field in this contract. Extra runtime
fields are discarded before queueing; invalid dimension values reject the fact.
Error categories are allowed only with failed, skipped, or unknown outcomes.
An unknown outcome means result evidence is unavailable. A failed outcome with
an unknown error category establishes failure without classifying its cause.

## Delivery policy

| Option | Default | Accepted values |
| --- | --- | --- |
| `sink` | No-op | Application-owned function |
| `capacity` | 256 records | Integer from 1 to 65,536 |
| `batchSize` | Smaller of 32 and capacity | Integer from 1 to capacity |
| `exportTimeoutMs` | 1,000 milliseconds | Integer from 1 to 60,000 |

Without a sink, `createTelemetry` returns the shared `noopTelemetry`. It
evaluates no facts, retains no queue, and starts no timers. Other options are
ignored in this disabled mode. Production and development use the same explicit
opt-in policy.

Enabled delivery uses one exporter call at a time. Capacity includes queued and
exporting records. A full queue refuses new facts and increments `dropped.overflow`.
`record` returns before the exporter runs. Synchronous exporter failures,
rejected promises, and rejected thenables increment `dropped.exportError`;
delivery continues with later batches. There are no automatic retries.

An exporter deadline aborts its signal, drops pending records, and disables the
instance. The signal carries a `TimeoutError`; disposal carries an `AbortError`.
The library cannot forcibly stop an exporter that ignores the signal.
It starts no further calls on that instance, so stalled external work cannot
accumulate. Detect this condition through `getSnapshot().state === 'timed_out'`.
Create a new instance after replacing or repairing the sink.

`flush(timeoutMs)` waits for facts accepted before the call. Its default deadline
is 1,000 milliseconds. Later facts cannot extend that barrier. `settled` means
those exporter calls completed, including rejection; inspect delivery and loss
counts. `deadline_exceeded` stops waiting and leaves delivery running.

`dispose` aborts the current export and drops pending records immediately. Call
and await `flush` first when shutdown delivery matters. A fulfilled sink call
proves acknowledgment by the sink, not persistence in a remote backend.

## HTTP sink acknowledgement

A sink must finish within `exportTimeoutMs`. It can await a bounded network
request or acknowledge acceptance into an application-owned exporter queue.
Fulfillment counts as delivery at that boundary. For HTTP, check the response
status: `fetch` also fulfills for HTTP error responses.

```ts
import { createTelemetry } from '@maelstrom-co/telemetry';

const telemetry = createTelemetry({
  exportTimeoutMs: 5_000,
  async sink(batch, signal) {
    const response = await fetch('https://telemetry.example.invalid/metrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
      signal,
    });
    if (!response.ok) throw new Error('Telemetry destination rejected the batch');
  },
});
```

Replace the example URL with your destination. The application owns any
credentials, queue bounds, retries, and persistence guarantees.

## Delivery states and flush outcomes

| Snapshot state | Meaning |
| --- | --- |
| `active` | Accepts facts and delivers queued batches. |
| `disabled` | No sink was configured; the shared no-op has no delivery lifetime. |
| `timed_out` | An exporter deadline stopped this instance permanently. |
| `disposed` | The application ended delivery and discarded pending records. |

| Flush outcome | Meaning |
| --- | --- |
| `settled` | Earlier accepted records were acknowledged or lost to exporter rejection. Inspect the counters. |
| `deadline_exceeded` | This flush stopped waiting; delivery continues. |
| `disabled` | Delivery is unavailable. `snapshot.state` distinguishes no-op from exporter timeout. |
| `disposed` | Delivery ended before this flush could finish. |

## Metadata projection

`projectDiagnosticMetadata(kind, metadata, provider?)` accepts only an event kind
and metadata. It accepts no diagnostic envelope or content reader. It returns a
`TelemetryFact` for supported request, application, Action, planning, stage,
and voice tool observations. Recognized terminal events with missing or invalid
outcome evidence produce `outcome: 'unknown'`. Unknown kinds return `undefined`.

Only local `durationMs` measurements pass through. The projector reads no
cross-process timestamps. Provider category comes from explicit application
configuration. It ignores diagnostic provider labels, custom stage names,
identifiers, error text, content, and raw provider frames.

The projector does not deduplicate observations or establish their ownership.
Producer adapters must publish each owned fact once. Detailed trace correlation,
usage reporting, and additional producer coverage need separate contracts.

Telemetry does not enable DevTools, content recording, or Engine-to-browser
forwarding. Application success and task acceptance require application-owned
product signals.
