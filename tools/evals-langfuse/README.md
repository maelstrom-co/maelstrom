# Optional Langfuse v3 eval sink

Private, non-published tooling for **self-hosted Langfuse OSS 3.163.0** and
**Node ≥24**. It implements `EvaluationResultSink`; the evaluator does not depend
on this package. Core evals still supports Node ≥20. A CLI supports explicit
preview and publication of saved result summaries and native full-planner runs. No service provisioning,
CI workflow, dataset sync, or automatic upload is installed.

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

## CLI: local use and future CI

Run from the workspace root with **Node ≥24** and installed workspace dependencies.
Native Node TypeScript support is sufficient; the CLI needs no build or loader,
does not load `.env`, and never executes a provider. Run it in its own Node
process, not as an embedded API in a host that may have initialized the SDK.
Use the same standalone entrypoint in a future CI job:

```sh
node tools/evals-langfuse/cli.ts --help
# Optional uncached Nx wrapper (direct Node keeps stdout machine-readable):
bunx nx run evals-langfuse:cli --args="--help" --skip-nx-cache --skipSync
```

Launchers such as Nx may populate the inherited environment themselves. Use the
direct Node command when you need to control environment loading and log output.

### 1. Preview saved evidence, without credentials

The default input must be one finalized `EvaluationResult` JSON object, not a
dataset, `records.json`, a run summary, or console output containing log lines.
For a native full-planner output directory, use the separate format below. For a
saved D35/D39 manual report, add **`--input-format manual-report`** to explicitly
select its `.result`. The default `result` format never detects wrappers.
Export historical evidence from the saved report; do not rerun an evaluation to
publish it. The CLI neither executes nor rescores cases and does not change
human-review flags.

```sh
args=(
  --input /secure/eval-result.json
  --destination evals-project
  --artifact summary
  --prepared-at 2026-10-27T15:00:00.000Z
  --base-url https://langfuse.example.com
  --server-version 3.163.0
)
node tools/evals-langfuse/cli.ts "${args[@]}" \
  --preview-out /secure/publication-preview.json
```

This is the default dry-run mode. It never reads credential variables, imports
the SDK, constructs a client, or calls the network. It writes a new file with
mode `0600`; existing files and symlinks are not overwritten, and parent
directories must already exist. Input defaults to an **8 MiB** bound of
regular-file UTF-8 JSON (`--max-input-bytes` can raise it explicitly). Protect the
input locally: it can contain raw evidence even though only a summary is exported.

Inspect the preview locally, including the exact `publication.json` string,
destination, physical base URL, server version and limits. Even summary
identity/provenance can be sensitive. Do not dump the preview into public CI
logs. The JSON status on stdout contains only fixed status codes, hashes and
byte counts, not payload, endpoint, identity text, paths or raw errors.

The returned `approvalSha256` is SHA-256 of the **entire preview file**, including
its trailing newline. It binds endpoint and limits as well as publication bytes,
destination and artifact. `payloadDigest` or `publicationId` alone is **not**
sufficient approval: neither binds the physical endpoint. Keep the destination
and URL in trusted invocation configuration, not in the input artifact.

### Native full-planner runs from an earlier bash run

Use the existing `EVAL_OUT` directory written by the full-planner runner. This
mode requires **both** `records.json` (native `RunRecord[]`) and `summary.json`
(`{ meta, summaries }`); it does not accept stage-eval outputs or scrape logs.
Native `meta.arms` must be a comma-separated string of nonempty, unique arm
names; `meta.repeats` and `meta.scenarios` must be positive safe integers. The
importer rejects unsafe products or a record count different from
`scenarios × repeats × number of arms` before preview approval, credential access
or publication. Do not modify or regenerate these files while importing them.

```sh
# EVAL_OUT is the output directory from the earlier completed run.
args=(
  --input-format full-planner-run
  --input "$EVAL_OUT"
  --destination evals-project
  --artifact summary
  --prepared-at 2026-10-27T15:00:00.000Z
  --base-url https://langfuse.example.com
  --server-version 3.163.0
)
node tools/evals-langfuse/cli.ts "${args[@]}" \
  --preview-out "$EVAL_OUT/langfuse-preview.json"
# Inspect the entire preview locally, then use its approved hash:
node tools/evals-langfuse/cli.ts "${args[@]}" \
  --publish --approve-sha256 'REVIEWED_PREVIEW_SHA256'
```

The version-2 preview envelope binds **every** per-sample publication, both
source-file SHA-256 digests, endpoint/destination, fixed preparation timestamp
and all limits. Its `source.actualRecordCount` and `source.expectedRecordCount`
show the validated count comparison. The opaque run ID is SHA-256 of the UTF-8 domain
`maelstrom/full-planner-run/v1` plus a NUL byte, then each file's unsigned
8-byte big-endian byte length and exact bytes, in `records.json`, `summary.json`
order. Even changes to whitespace or omitted raw fields change run identity.
Each sample is `(runId, scenarioId, arm, repeat)`; duplicate
`(scenarioId, arm, repeat)` tuples are rejected, even when suite/kind differ.

The importer exports only identity, bounded status/count summaries and the
explicitly reviewed boolean metadata `expectedDeferral` and, when present,
`deferredAsExpected`. It never copies summary metadata, prompts, user messages,
plans, trees, stage/LLM payloads, grader outputs, error text or raw responses.
The metadata is a narrow core publication projection, not a recording or a new
score type; it is visible in the reviewed summary stored as the span output.

| Native record | Imported status / correctness |
| --- | --- |
| Explicit runner `error` | execution error, unscored; no Boolean score |
| `expectedDeferral: true` | unscored, regardless of optional scores/deferral flags |
| Otherwise, explicit Boolean `score.pass` | pass/fail, planned; Boolean `eval.correctness` |
| Otherwise, missing score/pass | unscored, never inferred N/A |

A scored fallback stays scored even if an earlier stage deferred. Neither an
expected deferral nor `deferredAsExpected: false` establishes the final runtime
disposition. Unscored imports leave disposition unspecified. Completeness is
`complete` only for an explicit imported planned score; otherwise score evidence
is `absent`. This does not certify a complete execution recording or that the
full suite finished. Count equality is **structural consistency only**, not proof
of semantic completeness, correct scenario selection or truth of the supplied
metadata. A selected scenario subset is valid when its declared counts match.

**Langfuse correctness averages will not generally equal native `overall`.**
The native denominator includes planned error and missing-score rows; this
importer does not turn them into zero-quality scores. Expected-deferral rows
are excluded from native `overall` and remain non-score facts here. The secondary
grader is not substituted for the native deterministic score.

Before credentials or sends, the entire batch is validated, including every
mapped ingestion request's byte limit. Publication is **sequential and
non-atomic**, through the common reviewed-object publisher; it stops at the first
non-accepted receipt. JSON output retains each attempted item's publication ID,
payload digest, delivery status and reason, plus the `unsent` count. If any prefix
was accepted before stopping, aggregate status is `partial`; otherwise it is the
first non-accepted status. All accepted yields `accepted`. Shutdown uncertainty
still exits 3. Preserve these receipts; there is no automatic retry/resume or
cross-process exactly-once guarantee. No evaluations are rerun.

### 2. Explicitly publish the reviewed summary

Only these two environment variables are supported CLI configuration inputs.
They are read only after input, configuration and approval validation in publish
mode:

| Environment variable | Value |
| --- | --- |
| `LANGFUSE_PUBLIC_KEY` | Project public key for the approved deployment |
| `LANGFUSE_SECRET_KEY` | Project secret key for the approved deployment |

Inject them through a trusted local environment or CI secret store. Never put
keys in flags, evidence files, shell history or logs. The CLI does not load
`.env`; destination, endpoint, server version and bounds come from explicit
flags, not SDK environment defaults. Prefer HTTPS; an explicitly selected HTTP
endpoint does not protect credentials in transit.

The pinned SDK reads global logging settings during import, and its unused score
manager reads flush settings during construction. Before that lazy import and
construction, the standalone CLI temporarily sets `LANGFUSE_DEBUG=false` and
`LANGFUSE_LOG_LEVEL=NONE`, and removes `LANGFUSE_FLUSH_AT` and
`LANGFUSE_FLUSH_INTERVAL`. This prevents ambient debug logging of keys/endpoints
and ignores ambient queue controls. The original environment is restored in
`finally` immediately after startup; the SDK has captured those safe settings.
The adapter never enqueues scores, so the score manager's default flush settings
do not control publication. This startup isolation assumes a fresh standalone
process: an already-initialized SDK logger in an embedding host is unsupported,
and the CLI does not reconfigure a shared global logger.

Repeat the same input/configuration and fixed preparation timestamp, replacing
the preview-output flag with explicit publication and the reviewed hash:

```sh
node tools/evals-langfuse/cli.ts "${args[@]}" \
  --publish --approve-sha256 'REVIEWED_PREVIEW_SHA256'
```

The CLI re-prepares through the common review callback, compares the full preview
hash **before reading credentials**, and passes the returned reviewed object to
the common publisher. No serialized-object import or review bypass is used.
Changes to exported summary, endpoint, destination, artifact, timestamp, input
format or limits require a new preview and approval. In single-result modes,
changes to raw fields omitted from the summary do not change the approved bytes.
Full-planner mode additionally binds both complete source files, including
omitted fields, so any source-byte change requires a new preview. This is approval
to export summaries, not approval of semantic quality or a reliability claim.

A future CI caller uses this identical command and exit contract. Supplying the
hash noninteractively represents an explicitly configured automation policy;
it is not human acceptance. That policy must check the exact preview and trusted
destination. Do not blindly approve artifacts or endpoints from untrusted PRs.
No CI workflow is added or enabled here.

### Bounds and exit codes

| Flag | Default | Allowed range |
| --- | ---: | ---: |
| `--max-publication-bytes` | 16,384 | 1–`max-batch-bytes` |
| `--max-batch-bytes` | 65,536 | 1–3,500,000 |
| `--timeout-ms` | 10,000 | 1–300,000 |
| `--shutdown-timeout-ms` | 5,000 | 1–60,000 |
| `--max-in-flight` | 1 | 1–16 |
| `--max-input-bytes` | 8,388,608 | 1–134,217,728 (128 MiB) |
| `--max-publications` (full-planner only) | 1,000 | 1–10,000 |
| `--max-preview-bytes` (full-planner only) | 8,388,608 | 1–67,108,864 (64 MiB) |

Limits are positive decimal integers and included in the preview approval. In
full-planner mode the input byte limit covers **both files combined**; preview
bytes bound the entire envelope, while publication/batch byte limits apply per
sample. Increase bounds explicitly and review a new preview if a large saved run
needs it. The publication count caps the publisher ledger, and sends remain
sequential regardless of `max-in-flight`. Single-result modes use a one-entry
ledger; their mapped transport size can still reject a publication at delivery.
No bound is silently raised.

- **0**: preview written (or help), or every publication accepted with clean shutdown.
- **1**: known terminal publication failure with no accepted prefix.
- **2**: invalid arguments, runtime, input, config, approval, credentials, preview
  write, or sink initialization. Only fixed error codes are emitted.
- **3**: partial/uncertain delivery or uncertain shutdown, even if delivery was
  accepted. This must not be treated as success by CI.

The sink is always shut down after the publication attempt(s) in `finally`. The process exits
after that bounded wait; abort or process exit does not prove remote
cancellation. There are **no automatic retries**. An explicitly authorized retry
reuses the same saved result, timestamp, settings and approval hash, not a new
model run. Receipts remain acknowledgments, not proof of durable storage,
exactly-once delivery, retention or deletion. Deployment access and retention
policy still require approval before any real publication.

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
  sending. Adapter outcomes contain no raw SDK error text. The standalone CLI
  also suppresses SDK logging during startup; applications composing the sink
  directly own their SDK logging configuration.
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

Tests deny global fetch or explicitly intercept SDK requests with synthetic
receipts, without network. They exercise mapping, omission,
score exclusions, stable identity, partial/unknown receipts, batch bounds,
abort/deadline behavior, export-only retries, shutdown ownership and global OTel
isolation. CLI tests also cover endpoint-bound approval, no credential reads in
preview or rejected publication, bounded input, private/no-overwrite preview
files, sanitized exit codes and native Node entrypoint behavior. Fresh-process
regressions construct the real SDK with ambient debug/flush controls, intercept
fetch with synthetic receipts, and verify no credential/endpoint logs and full
environment restoration. `--skipSync` avoids the pre-existing workspace
solution-reference drift; it does not skip typechecking or test execution.

Live activation still needs destination/access approval, a bounded synthetic
smoke test against the actual v3.163.0 server, verified size/idempotency/retrieval
behavior and retention/deletion policy. No private archive repository is used.
Hosted dataset-run comparisons and a separate run-level aggregate publication
remain future work; full-planner import emits per-sample publications.
