---
status: done
---

# Lazy runtime-loader rework

Implemented the approved Phase 1 loader boundary.

Changes:

- Added package-private `greeting-interruption-runtime.ts` with a production
  dynamic import of `@maelstrom-co/realtime-vad` and a scoped importer seam.
- Retained the resolved enabled/disabled configuration in `OpenAIAdapter`.
- Enabled connection preparation loads the runtime after microphone acquisition
  and before peer track publication; omitted and explicit `false` never call it.
- Added direct loader success/rejection tests and adapter call-count assertions
  for omitted, false, and enabled configurations.
- Kept the default-off Vite graph test proving omitted and false have identical
  static graphs without VAD, ONNX, or worklet runtime code.

Verification:

- OpenAI loader, adapter, and default-off bundle tests: 139 passed.
- OpenAI typecheck and build: pass.
- Biome for edited OpenAI/VAD source: pass with warnings treated as errors.

The loader rejection is intentionally preserved for the later connection-level
fallback phase. No bridge, VAD lease, generated track, or interruption behavior
is introduced in this phase.
