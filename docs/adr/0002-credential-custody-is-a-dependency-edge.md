# Credential custody is a dependency edge, not a convention

Packages sort into four layers — **contract**, **browser**, **server**, **worker** — and no server or worker package may depend on a browser package. This was previously documented in prose and silently became false: `@maelstrom-co/realtime-livekit-server`, a Node-only package holding `LIVEKIT_API_KEY`, grew a dependency on `@maelstrom-co/realtime-livekit`, which declares the browser WebRTC SDK `livekit-client` as a peer dependency. Installing the token minter into a backend therefore demanded a browser SDK. The shared vocabulary both sides needed now lives in the dependency-free `@maelstrom-co/realtime-protocol` leaf, so neither layer has to reach across the boundary to find it.

The rule is enforced by `packages/realtime-protocol/src/layer-boundary.test.ts`, which reads `package.json` manifests and classifies packages by naming convention so new ones are covered automatically. **The invariant is stated in full in that test's failure messages, and documentation links to the test rather than restating it** — a restated rule is exactly what rotted last time.

## Consequences

Two non-obvious details a future reader will otherwise trip over.

A browser package may ship Node-only tooling, but only behind a declared non-root entry point. `@maelstrom-co/realtime-vad` ships an asset copier and a CLI for deploying its own Silero and ONNX files; these live behind `./assets` and `src/bin/` and are never reachable from `.`. The boundary test asserts this rather than granting an exception.

Biome resolves `overrides` globs relative to the config that extends the shared one, not the repo root. Since nearly every package carries its own `biome.json`, a root-level override targeting `packages/*-server/**` silently matches nothing in precisely the packages it was written to protect. The `noRestrictedImports` backstop is therefore declared in each server and worker package's own config, and the boundary test asserts that every one of them covers every browser package — otherwise that copy-paste obligation would rot the same way the prose did.
