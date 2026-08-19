---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

## High — Failed manual/clear reset coverage was lost while adding the exact-bound checks

In the table at `packages/realtime-vad/src/local-audio-pre-roll.test.ts:394`, the initial 500 ms automatic start is followed by a successful manual or clear request at 249 ms. That successful request already resets `activePreRollMs` to zero. The subsequent failed manual/clear request therefore begins from zero, so the 501 ms end timeout does not prove that failure resets a previously active 500 ms duration.

Re-establish an acknowledged 500 ms automatic turn after the just-before-bound success and immediately before each operation whose failure is under test, or separate exact-timeout and active-duration-reset coverage. Keep the automatic row's equivalent prior-active-state proof.

## Medium — The revocation case does not test cleanup-time error preservation as claimed

At `packages/realtime-vad/src/local-audio-pre-roll.test.ts:510-537`, the `revoke` stage lets module loading succeed and throws from the factory's normal immediate revocation call. The revocation error is therefore itself the primary construction error. Conversely, the `module` stage fails module loading but allows cleanup-time revocation to succeed. This does not exercise the requested combination where module initialization fails, cleanup-time `URL.revokeObjectURL` also throws, later resources are still released, and the module error remains the rejection.

Inject the revocation failure while the module stage is already failing (or add a dedicated combined case), then assert the module error and all later cleanup counts. The standalone object-URL creation boundary can remain as-is.
