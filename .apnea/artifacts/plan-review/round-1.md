---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

1. **High — The plan does not define a recoverable path for bridge/worklet failures after the generated track has been attached.** Phase 2 covers pre-attachment pre-roll preparation failure and VAD failure after attachment, but it does not specify what happens when `LocalAudioPreRoll.startAutomaticTurn()` or `startManualTurn()` rejects or times out. At that point the peer is publishing the owner-managed generated track; keeping its gate held or destroying the bridge cannot restore usable microphone audio. The plan needs an explicit safe transport transition (for example, generation-fenced replacement with the raw track), ownership/cleanup rules for that transition, and focused tests for automatic-start and live-only/manual-start failure. This is required by the definition of done that runtime experimental failures preserve voice without leaking greeting-period audio.

2. **High — Default-off bundle compatibility is asserted but not planned or verified.** The goal requires omitted/`false` to preserve current runtime **and bundle** behavior, while Phase 1 adds a runtime dependency on `@maelstrom-co/realtime-vad` and only checks that setup functions are not invoked. A static import from the package entry can still cause consumer builds to emit/include the VAD dynamic-import graph even when every construction site passes `false`. Add an implementation strategy that keeps the VAD/worklet runtime behind the enabled branch and a bundle/packed-consumer assertion comparing omitted and explicit-false behavior; the existing package `build` and API audits do not prove this property.
