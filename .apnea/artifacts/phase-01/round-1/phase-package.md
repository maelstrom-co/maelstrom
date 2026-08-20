---
status: done
---

# Phase 1 package: opt-in API and default-off loading boundary

## Intent

Add the public `greetingInterruption?: false | true | BrowserVadOptions` contract, synchronous validation foundation, and a testable lazy runtime-loader boundary without implementing the interruption lifecycle yet. Split browser-VAD configuration from runtime code so omitted and explicit `false` keep the current raw-microphone path and static bundle graph. This phase must leave both packages green and create a bundle regression guard that Phase 2 must continue to satisfy.

## Files to touch

- `packages/realtime-vad/package.json`
- `packages/realtime-vad/vite.config.ts`
- `packages/realtime-vad/src/index.ts`
- `packages/realtime-vad/src/browser-vad.ts`
- `packages/realtime-vad/src/browser-vad-config.ts` (new)
- `packages/realtime-vad/src/browser-vad.test.ts`
- `packages/realtime-vad/README.md`
- `packages/realtime-openai/package.json`
- `packages/realtime-openai/tsconfig.lib.json`
- `packages/realtime-openai/vite.config.ts`
- `packages/realtime-openai/src/index.ts`
- `packages/realtime-openai/src/openai-adapter.types.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`
- `packages/realtime-openai/src/greeting-interruption-runtime.ts` (new)
- `packages/realtime-openai/src/greeting-interruption-runtime.test.ts` (new)
- `packages/realtime-openai/src/default-off-bundle.test.ts` (new)
- `bun.lock`

## Files not to touch

- `packages/realtime-vad/src/browser-vad.types.ts`
- `packages/realtime-vad/src/local-audio-pre-roll.ts`
- `packages/realtime-vad/src/local-audio-pre-roll.test.ts`
- `packages/realtime-openai/src/greeting-presentation.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`
- `packages/realtime-openai/src/microphone-publication-gate.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.ts`
- Any greeting-interruption lifecycle owner beyond the runtime loader; that belongs to Phase 2.
- `apps/demo/**`
- `apps/docs/**`
- `.apnea/state.json`

## Exact steps

### 1. Extract configuration into a runtime-light subpath

Create `packages/realtime-vad/src/browser-vad-config.ts` by moving, not rewriting, these pieces out of `browser-vad.ts`:

- `ResolvedBrowserVadConfig` and its enabled/disabled discriminant.
- Default asset URL, default pre-roll, and maximum pre-roll constants used by resolution.
- The provider-option allowlist.
- `resolveBrowserVadConfig`.
- Asset URL normalization.
- Provider option validation and its ratio/non-negative/plain-object helpers.

The new module must import `BrowserVadOptions` and `BrowserVadProviderOptions` with `import type`. It must also export those public types from the config entry so OpenAI consumers can obtain all configuration contracts without importing the runtime root.

Preserve every existing validation rule and default:

- `resolveBrowserVadConfig(undefined)` and `true` remain enabled with `/vad-web/`, `250` ms, and empty provider options.
- `false` remains disabled.
- Pre-roll remains finite and within `0..500`.
- Asset URLs retain the current relative/credential-free HTTPS rules.
- The provider allowlist, falsey-value preservation, and error messages remain unchanged for existing `vad` callers.

In `browser-vad.ts`:

- Import the resolved config type from `browser-vad-config.ts`.
- Keep `createBrowserVad`, `BrowserVad`, and `CreateBrowserVadOptions` there.
- Remove the moved constants, resolver, and validation helpers.
- Keep the existing dynamic `import('@ricky0123/vad-web')` unchanged.
- Define any file-local enabled-config extraction needed by `CreateBrowserVadOptions`; do not create a reverse import from config into runtime.

Update `browser-vad.test.ts` so config tests import `resolveBrowserVadConfig` from `./browser-vad-config.js`, while VAD lifecycle tests still import `createBrowserVad` from `./browser-vad.js`. Keep the existing validation matrix intact.

### 2. Publish `@maelstrom-co/realtime-vad/config`

Update `packages/realtime-vad/package.json` with a `./config` export:

- source condition: `./src/browser-vad-config.ts`;
- types condition: the declaration emitted for `browser-vad-config.ts`;
- import/default condition: the config JavaScript entry emitted by Vite.

Update `packages/realtime-vad/vite.config.ts` with a config library entry. Keep the existing root, asset helper, and CLI entries unchanged. Keep `@ricky0123/vad-web` and `onnxruntime-web` external.

Update `packages/realtime-vad/src/index.ts`:

- Re-export `resolveBrowserVadConfig`, `ResolvedBrowserVadConfig`, `BrowserVadOptions`, and `BrowserVadProviderOptions` from `browser-vad-config.ts`.
- Continue exporting browser-VAD runtime types/functions and local pre-roll from their current modules.
- Do not duplicate exports from both old and new modules.

Add the config subpath to the README entry-point list. State only that it is the validation/type-only loading boundary; defer OpenAI feature documentation to Phase 4.

### 3. Add the OpenAI package dependency boundary

Update `packages/realtime-openai/package.json` to depend on `@maelstrom-co/realtime-vad` using the same internal package-version convention as its other Maelstrom dependencies.

Update `packages/realtime-openai/tsconfig.lib.json` with a project reference to `../realtime-vad/tsconfig.lib.json`.

Update `packages/realtime-openai/vite.config.ts` so every `@maelstrom-co/realtime-vad` specifier, including `/config`, is external. Prefer one anchored regular expression matching the package root and subpaths. Do not add provider or ONNX dependencies directly to the OpenAI package.

Run `bun install` after manifest edits and accept only the corresponding `bun.lock` workspace dependency update.

### 4. Add the public option and lazy runtime-loader boundary

In `openai-adapter.types.ts`:

- Import `BrowserVadOptions` as a type from `@maelstrom-co/realtime-vad/config`.
- Add `readonly greetingInterruption?: false | true | BrowserVadOptions` to `OpenAIAdapterOptions`.
- Document it as experimental and default-off.
- State that omitted/`false` retain the current non-interruptible greeting gate.
- State that `true` selects shared defaults and an object selects validated browser-VAD settings.
- Do not describe interruption timing or acoustic outcomes yet; those behaviors arrive in later phases.

In `packages/realtime-openai/src/index.ts`, re-export `BrowserVadOptions` and `BrowserVadProviderOptions` as types from `@maelstrom-co/realtime-vad/config`.

In `openai-adapter.ts`:

- Statically import only `resolveBrowserVadConfig` and its resolved type from `@maelstrom-co/realtime-vad/config`.
- Add a small package-private normalization helper for the OpenAI option.
- Return `{ enabled: false }` directly for omitted and `false`. Do not pass omitted through the shared resolver because `resolveBrowserVadConfig(undefined)` intentionally means enabled for existing LiveKit callers.
- Resolve `true` and object values through the shared resolver.
- Catch shared `TypeError` values and replace only the leading diagnostic prefix `vad` with `greetingInterruption`; retain the original error as `cause` if the repository's target supports it.
- Call the helper in the constructor before assigning callbacks or creating any asynchronous work.
- Retain the resolved enabled discriminant. Add a package-private, injectable `loadGreetingInterruptionRuntime()` seam whose production implementation performs `import('@maelstrom-co/realtime-vad')`.
- Invoke that loader only from enabled connection preparation. Omitted and explicit `false` must never call it. Phase 1 does not create a bridge or VAD lease; Phase 2 consumes the loaded module through this boundary.
- Add direct loader tests for one dynamic import, rejection propagation, and injection. Add adapter tests proving enabled connection reaches the loader while omitted/false never do.

This temporary validate-only behavior is acceptable inside the multi-phase change because the phase is not a released endpoint. The tree must remain green, and omitted/`false` behavior must be complete.

### 5. Add synchronous validation tests

Extend `openai-adapter.test.ts` with constructor tests covering:

- omitted and `false` accepted as disabled;
- `true` accepted;
- a valid options object accepted;
- invalid primitive, array, and null runtime values rejected;
- unsafe asset URLs rejected;
- non-finite/out-of-range pre-roll rejected;
- unsupported or malformed provider tuning rejected.

Use casts only at the invalid-runtime boundary. Assert errors are synchronous `TypeError`s whose public message starts with `greetingInterruption`, not `vad`.

For rejected construction, assert no token mint, `getUserMedia`, `RTCPeerConnection`, runtime import, bridge, or VAD work occurs. Constructor rejection should be observable before calling `connect()`.

Add or extend connection tests for both omitted and explicit `false`:

- The original microphone track is passed to `RTCPeerConnection.addTrack`.
- `getAudioStreams().mic` remains the original stream.
- Existing greeting gating behavior remains unchanged.
- No generated track or new turn-control state appears.

Do not add enabled interruption assertions in this phase.

### 6. Add the default-off bundle regression test

Create `packages/realtime-openai/src/default-off-bundle.test.ts`. Use Vite's programmatic `build` API with `configFile: false` and `write: false` to build two tiny virtual consumer entries separately:

1. `new OpenAIAdapter({ mintToken })` with the option omitted.
2. `new OpenAIAdapter({ mintToken, greetingInterruption: false })`.

Alias the consumer's OpenAI import to this package's source entry so the test examines the code under change. Externalize unrelated Maelstrom dependencies consistently in both builds. Bundle the config-only realtime-VAD subpath so its module closure can be inspected instead of trusting an external bare specifier.

Normalize generated chunk metadata into module/import graphs rather than comparing minified text or hashes. Entry literals will differ, but these properties must match:

- identical static module/import sets for omitted and explicit `false`;
- `browser-vad-config.ts` and type-erased configuration code may be in the static closure;
- `browser-vad.ts`, `local-audio-pre-roll.ts`, `@ricky0123/vad-web`, `onnxruntime-web`, and pre-roll worklet source must not be in the static closure;
- no runtime module is executed merely by constructing either adapter.

Make the assertion future-proof for Phase 2: a later dynamic edge to the realtime-VAD runtime root is allowed, but it must never become a static import of either default-off entry.

Do not assert equal emitted bytes, performance, or device behavior.

### 7. Verify package boundaries and inspect the final diff

After all tests pass:

- Confirm `@maelstrom-co/realtime-vad/config` resolves from source and built package output.
- Confirm the OpenAI declaration names `BrowserVadOptions` through the config subpath.
- Confirm no static OpenAI source import references bare `@maelstrom-co/realtime-vad` in this phase.
- Confirm `browser-vad.ts` still owns the only provider dynamic import.
- Confirm no demo/docs files or runtime greeting classes changed.

## Acceptance checks

- `@maelstrom-co/realtime-vad/config` exports shared config types and synchronous resolution without a static path to VAD, ONNX, or pre-roll runtime.
- Existing realtime-VAD root imports, defaults, validation, and LiveKit-facing behavior remain unchanged.
- `OpenAIAdapterOptions` exposes `greetingInterruption?: false | true | BrowserVadOptions` and the OpenAI root re-exports the shared option types.
- Invalid enabled configuration throws synchronously with a `greetingInterruption` diagnostic and no token/media/peer/import work.
- Omitted and explicit `false` retain original raw-track attachment, raw metering, greeting gating, and turn mode.
- Omitted and explicit `false` produce identical static consumer module/import graphs.
- The default-off static graph excludes realtime-VAD runtime, local pre-roll, provider VAD, ONNX runtime, and worklet code.
- The package-private owner, playback hooks, enabled connection behavior, runtime fallback, demo, and docs remain untouched for later phases.

## Verify commands

Run from the workspace root in this order:

```bash
bun install
bunx nx run @maelstrom-co/realtime-vad:check
bunx nx run @maelstrom-co/realtime-vad:test
bunx nx run @maelstrom-co/realtime-vad:typecheck
bunx nx run @maelstrom-co/realtime-vad:build
bunx nx run @maelstrom-co/realtime-openai:check
bunx nx run @maelstrom-co/realtime-openai:test
bunx nx run @maelstrom-co/realtime-openai:typecheck
bunx nx run @maelstrom-co/realtime-openai:build
```

If a focused failure needs isolation, use:

```bash
bun test --cwd packages/realtime-vad src/browser-vad.test.ts
bun test --cwd packages/realtime-openai src/default-off-bundle.test.ts src/openai-adapter.test.ts
```

Before reporting completion, run diagnostics on all edited TypeScript files and then run:

```bash
bunx nx run @maelstrom-co/realtime-vad:check
bunx nx run @maelstrom-co/realtime-openai:check
```

## Dependencies

- Existing browser-VAD validation in `packages/realtime-vad/src/browser-vad.ts` is the source of truth to extract.
- Existing `OpenAIAdapter` constructor ordering and raw microphone path are the behavior baseline.
- Vite's programmatic build output supplies the bundle graph assertion.
- Phase 2 depends on this phase's resolved config type, config-only subpath, public option, and bundle guard.

## Non-goals

- Do not implement `GreetingInterruption` or enabled greeting interruption.
- Do not create the greeting-interruption lifecycle owner, bridge, VAD lease, or generated-track publication yet; establish the lazy loader boundary and regression guard only.
- Do not create or attach `LocalAudioPreRoll` tracks.
- Do not change greeting synthesis, playback, Skip, history, response arbitration, or teardown.
- Do not change LiveKit VAD behavior or shared validation semantics.
- Do not enable the option in the demo or write feature docs.
- Do not add real-device, self-echo, VAD-accuracy, first-phoneme, or latency claims.
- Do not commit or edit `.apnea/state.json`.
