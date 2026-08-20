---
status: done
---

Implemented Phase 1 only.

## Changed

- Extracted browser-VAD configuration resolution and validation into the new runtime-light `@maelstrom-co/realtime-vad/config` entry point, preserving existing defaults and validation behavior.
- Published the config export and Vite entry; retained the provider dynamic import exclusively in `browser-vad.ts`.
- Added the experimental, default-off `greetingInterruption` OpenAI option with synchronous shared-config validation and `greetingInterruption`-prefixed errors.
- Added the realtime-VAD dependency/reference/external boundary and OpenAI type re-exports.
- Added validation/default-off raw-track tests and a Vite static module/import graph regression test.
- Updated the realtime-VAD entry-point README and lockfile workspace dependency.

Files touched are limited to the Phase 1 package list, plus the required result artifact.

## Verification transcript

```text
$ bun install
exit 0
bun install v1.3.7 (ba426210)
Resolving dependencies
Resolved, downloaded and extracted [5]
Saved lockfile
Checked 1926 installs across 2178 packages (no changes) [799.00ms]

$ bunx nx run @maelstrom-co/realtime-vad:check
exit 0
> biome check packages/realtime-vad --error-on-warnings
Checked 17 files in 18ms. No fixes applied.
NX   Successfully ran target check for project @maelstrom-co/realtime-vad

$ bunx nx run @maelstrom-co/realtime-vad:test
exit 0
NX   Successfully ran target test for project @maelstrom-co/realtime-vad
Run duration: 1.1s

$ bunx nx run @maelstrom-co/realtime-vad:typecheck
exit 0
NX   Successfully ran target typecheck for project @maelstrom-co/realtime-vad and 1 task it depends on
Run duration: 1.1s

$ bunx nx run @maelstrom-co/realtime-vad:build
exit 0
computing gzip size...
dist/config.js                       0.10 kB │ gzip: 0.10 kB
dist/browser-vad-config-DEuNQW_0.js  2.83 kB │ gzip: 1.10 kB
dist/index.js                        8.84 kB │ gzip: 2.93 kB
✓ built in 543ms
NX   Successfully ran target build for project @maelstrom-co/realtime-vad

$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0
> biome check packages/realtime-openai --error-on-warnings
Checked 25 files in 57ms. No fixes applied.
NX   Successfully ran target check for project @maelstrom-co/realtime-openai

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0
NX   Successfully ran target test for project @maelstrom-co/realtime-openai and 5 tasks it depends on
Run duration: 313ms

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0
NX   Successfully ran target typecheck for project @maelstrom-co/realtime-openai and 6 tasks it depends on
Run duration: 1.3s

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0
computing gzip size...
dist/index.js  27.52 kB │ gzip: 7.74 kB
✓ built in 654ms
NX   Successfully ran target build for project @maelstrom-co/realtime-openai and 5 tasks it depends on

$ bunx biome check <all 11 edited TypeScript files> --error-on-warnings
exit 0
Checked 11 files in 54ms. No fixes applied.

$ cd packages/realtime-openai && node --conditions=@maelstrom-co/source --input-type=module -e "import('@maelstrom-co/realtime-vad/config')..."
exit 0
[ 'resolveBrowserVadConfig' ] { enabled: false }

$ cd packages/realtime-openai && node --input-type=module -e "import('@maelstrom-co/realtime-vad/config')..."
exit 0
[ 'resolveBrowserVadConfig' ] { enabled: false }
```

## Residual risks

Enabled `greetingInterruption` intentionally performs validation only in this phase; runtime VAD, pre-roll, greeting interruption, and fallback lifecycle behavior remain Phase 2+ work. No real-device acoustic, VAD-accuracy, first-phoneme-retention, echo-rejection, or latency claims were made.
