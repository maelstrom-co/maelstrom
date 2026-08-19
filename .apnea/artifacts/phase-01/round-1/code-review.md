---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

## High — The required lifecycle and partial-cleanup test matrix is largely missing

`packages/realtime-vad/src/local-audio-pre-roll.test.ts:234-378` covers end-timeout bounds, one stale end acknowledgement, unsupported APIs, and successful/idempotent teardown, but the phase package explicitly requires substantially more lifecycle evidence. There are no tests for:

- clamping/non-finite input and sample conversion, including the required 24,000 `maxSamples` at 48 kHz;
- exact 250 ms automatic/manual/clear acknowledgement bounds or active-duration reset after failed starts;
- unknown and duplicate acknowledgement IDs;
- missing generated-track cleanup;
- table-driven failures during module load, worklet construction/connection, and context resume;
- cleanup-operation failures, continued release of later resources, preservation of the original construction error, or surfacing the first normal-destroy cleanup error; or
- object URL revocation across success and partial initialization.

The reported green focused suite does not establish these phase acceptance checks. Add the specified fault-injection and lifecycle cases and include their passing evidence.

## High — Processor sample coverage does not satisfy the phase package

The four processor tests at `packages/realtime-vad/src/local-audio-pre-roll.test.ts:122-164` exercise the embedded source, but omit required cases: zero requested pre-roll, a shorter newest-tail selection with exact tail-before-live ordering, and acknowledged `clear()` behavior independently from idle, automatic, and manual states. The existing clear test covers an acknowledged pending-end clear and an unacknowledged manual clear only. The end test also does not assert that the end ID remains unacknowledged before processing the queued samples.

Add the missing sample-level cases so the public primitive's newest-tail, clear-state, and drain acknowledgement guarantees are directly protected rather than inferred from broader examples.
