---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

## High — Ordinary acknowledgement bounds are still not tested exactly

The table at `packages/realtime-vad/src/local-audio-pre-roll.test.ts:394` advances directly to 251 ms and checks rejection. A timeout at any earlier value would also pass, so this does not establish the phase package's exact 250 ms bound for automatic, manual, and clear requests. Add a just-before-bound assertion/acknowledgement case, analogous to the end-timeout matrix, for each operation.

The automatic-start row also begins with `activePreRollMs` already zero. It therefore does not prove that a failed automatic start clears a previously active 500 ms duration; manual and clear do establish that transition because they first acknowledge a 500 ms automatic start. Seed the automatic failure case with an acknowledged active duration before withholding the later automatic acknowledgement.

## High — The partial-initialization matrix still omits the object-URL failure boundary

The stage matrix at `packages/realtime-vad/src/local-audio-pre-roll.test.ts:473` begins with module loading, after `URL.createObjectURL` has already succeeded. The missing-track case fails before URL creation, and the normal cleanup-failure case runs after the URL has already been revoked. Consequently, no test covers the approved plan's explicit object-URL creation failure boundary, nor a revocation failure during construction while later resources are still released and the primary initialization error is preserved.

Add fault injection for `URL.createObjectURL` and for cleanup-time `URL.revokeObjectURL`, asserting the acquired source/generated-track/context cleanup counts and primary error alongside the existing module/node/connect/resume stages.
