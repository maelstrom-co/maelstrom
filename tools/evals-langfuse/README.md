# Optional Langfuse v3 eval sink

Private, non-published tooling for **self-hosted Langfuse OSS 3.163.0** and
**Node ≥24**. It implements `EvaluationResultSink`; the evaluator does not depend
on this package. Core evals still supports Node ≥20. No CLI, service provisioning,
dataset sync, or automatic upload is installed.

## Versioned API choice

This adapter uses the public **`LangfuseClient.api.ingestion.batch`** API from
`@langfuse/client@5.13.1`. It emits `trace-create`, `span-create`, and, when
appropriate, `score-create` events. This is deliberately a **v3-only** adapter.
It does not use SDK v6, `experiment.run`, private SDK internals, or an OTel global
provider. The public batch endpoint supplies per-event delivery receipts rather
than relying on a flush-only OTel acknowledgment.

The installed 5.13.1 public API declarations document per-event `successes` and
`errors`, the 3.5 MB batch limit, event-ID deduplication, and that this endpoint
remains available on self-hosted v3 but becomes unavailable on upgrade to v4.
The client is pinned in the root catalog. Its caret-ranged transitive
`@langfuse/core` and `@langfuse/tracing` dependencies are pinned to **5.13.1** by
root overrides; neither is imported directly here. The API peer is pinned to
`@opentelemetry/api@1.9.1`. Node ≥24 is this tool's chosen execution baseline, not
a claim that SDK v5 inherently requires it.

Release-specific evidence:

- [Client 5.13.1 public source tree](https://github.com/langfuse/langfuse-js/tree/v5.13.1/packages/client)
- [SDK 5.13.1 source tree](https://github.com/langfuse/langfuse-js/tree/v5.13.1/packages/core)
- [SDK compatibility overview](https://langfuse.com/docs/observability/sdk/overview)
- [v5 → v6 migration and removal of ingestion](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v5-to-v6)

Offline tests verify the pinned public SDK actually addresses
`POST /api/public/ingestion` and parses a mocked HTTP 207 response. No request to
the user's deployment has run; exact deployment compatibility, permissions,
retention and durable storage remain unverified. Reassess this adapter before
upgrading the server or SDK. It is not a Langfuse Cloud/v4 integration.

## Explicit lifecycle

1. Execute and score a case using the common runner. Retain its finalized result.
2. Prepare a publication through `prepareEvaluationPublication`, with explicit
   destination and review of exact bounded bytes. Summary is the default; only
   an explicitly reviewed projection can contain recording content.
3. Call `startLangfuseV3Sink(config)` with an explicitly approved destination,
   base URL, project credentials, asserted server version, batch/send/shutdown
   bounds and concurrency cap. There is no environment fallback or import-time
   initialization. Store credentials outside cases, recordings and browser code.
4. Pass that sink to `createEvaluationPublisher` and publish the reviewed value.
   Export retries reuse finalized evidence; they never rerun or rescore a case.
5. `await sink.shutdown()` after use. Admission closes immediately; in-flight
   requests receive an abort request. `uncertain` means shutdown exceeded its
   bound, not that delivery was cancelled. A borrowed test/application transport
   is not disposed; its caller owns it. The default private SDK client is closed
   after outstanding requests settle.

Example composition (configuration is supplied by the trusted caller, not case
content; invoking this against a real destination requires separate approval):

```ts
import { createEvaluationPublisher } from '../../packages/evals/src/core/publication.js';
import { startLangfuseV3Sink } from './sink.js';

const sink = startLangfuseV3Sink(approvedConfig);
const publisher = createEvaluationPublisher({
  destinationId: approvedConfig.destinationId,
  sink,
  timeoutMs: approvedConfig.timeoutMs,
  maxEntries: 100,
});
try {
  const delivery = await publisher.publish(reviewedPublication);
  // Delivery is separate from the already-finalized evaluation verdict.
} finally {
  await sink.shutdown();
}
```

## Mapping and boundaries

- One private trace/root observation per **publication**, not one hosted
  experiment per run. Run ID groups traces via session identity and metadata;
  sample, artifact and payload digest remain distinct.
- The root observation contains exactly the reviewed JSON payload, including
  omission/completeness markers. This is a projected recording, **not a full
  replay archive**. No raw evidence is fetched or reconstructed. No media upload
  service runs and no canonical case/dataset is written remotely.
- Correctness is Boolean only for a completed, complete, error-free `pass` or
  `fail` verdict. Hand-offs, N/A, partial/absent evidence and execution/scoring
  errors keep their statuses without being converted to zero quality.
- Trace, span and score event timestamps come from the immutable UTC
  `preparedAt` in the reviewed publication JSON. Trace time and the span's
  instantaneous start/end mark **publication preparation**, not original
  evaluation execution time, latency or provider usage. No attempt-time clock
  is read. Persist/reuse those reviewed bytes across retries and sink instances;
  payloads without a canonical preparation timestamp fail before sending.
- Event IDs and trace/observation/score IDs derive deterministically from the
  content-bound publication ID. Different artifacts cannot overwrite one
  another. These IDs use documented event deduplication/upsert semantics, but
  **exactly-once delivery across retries/restarts is not certified**. Per-item
  receipts do not prove transactionality or completed background persistence.
- `accepted`: every expected event has one valid success receipt. `partial`:
  one or more valid event receipts confirm acceptance, but the batch is
  incomplete; remaining events may be rejected or unconfirmed, including
  missing receipts. `uncertain`: no accepted receipt is confirmed and the
  result remains unknown. Duplicate, foreign or malformed receipts invalidate
  receipt interpretation; transport errors, aborts and deadlines also remain
  uncertain. `failed`: every event has known terminal per-item rejection
  (4xx excluding timeout/rate-limit), or local validation/admission fails before
  sending. No raw SDK error text escapes.
- No automatic retry (`maxRetries: 0`), score queue, global OTel registration,
  tracing capture or ambient application instrumentation. SDK imports include
  tracing transitively, but this adapter never initializes it. No flush-only
  success is treated as delivery. A timed-out request remains counted against
  the in-flight limit until the transport actually settles.
- The batch cap includes mapping overhead and duplication of metadata; it may
  reject an approved payload that exceeds the configured transport budget.
  Configure it at or below 3,500,000 UTF-8 bytes. This does not verify server
  reverse-proxy or retention limits. The generic publisher performs review;
  directly calling a sink is trusted application code, not a review bypass
  protection or privacy scanner.

## Offline checks

```sh
bun test tools/evals-langfuse
bunx nx run evals-langfuse:typecheck --skip-nx-cache --skipSync
bunx nx run evals-langfuse:test --skip-nx-cache --skipSync
bunx nx run evals-langfuse:check --skip-nx-cache --skipSync
```

Tests deny global fetch except one explicitly mocked SDK-transport test, which
returns synthetic receipts without network. They exercise mapping, omission,
score exclusions, stable identity, partial/unknown receipts, batch bounds,
abort/deadline behavior, export-only retries, shutdown ownership and global OTel
isolation. `--skipSync` avoids the pre-existing workspace solution-reference
drift; it does not skip typechecking or test execution.

Live activation still needs destination/access approval, a bounded synthetic
smoke test against the actual v3.163.0 server, verified size/idempotency/retrieval
behavior and retention/deletion policy. No private archive repository is used.
Hosted dataset-run comparisons and run-level publication remain future work.
