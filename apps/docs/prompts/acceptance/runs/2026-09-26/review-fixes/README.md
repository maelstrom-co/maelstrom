# Prompt integration review fixes

This evidence is for the narrow follow-up review fix slice. It does not replace or rewrite the preserved original prompt-agent trial reports in the parent run directory.

## Changes checked

- Introduced prompt IDs (`maelstrom-react-conversion` and `maelstrom-vessel-modeling`) now correctly start at 1.0.0. The aggregate gate checks the locked `mmrywqnp` prompt-source snapshot (empty prompt directory) against the current canonical prompt tree.
- Both prompt routes use the Starlight page shell. Canonical Markdown is rendered as headings, lists, and tables while exact raw Markdown remains a separate transport used by Copy/Download. Metadata is kept outside that rendered content.
- The loader test verifies Astro Markdown renderer input, persisted rendered content, and exact raw body separation. The Playwright runner checks one Starlight page title, rendered headings/lists/tables, metadata separation, clipboard/download equality, filenames, and mobile overflow.
- The pre-review browser screenshots and README were copied unchanged to `../browser/pre-review/`; the refreshed screenshots use the current Starlight presentation and v1.0.0 metadata. The source prompt bodies are unchanged from the historical trial inputs.

## Uncached local evidence

- `typecheck.log`: `bunx nx run @maelstrom-co/docs:typecheck --skip-nx-cache` — pass; 0 errors, 0 warnings, 181 hints.
- `test.log`: `bunx nx run @maelstrom-co/docs:test --skip-nx-cache` — pass; 203 tests, 0 failures.
- `check.log`: `bunx nx run @maelstrom-co/docs:check --skip-nx-cache` — pass; Biome checked 102 files.
- `build.log`: `bunx nx run @maelstrom-co/docs:build --skip-nx-cache` — pass; 523 pages.
- `prompts-check.log`: `bun run --cwd apps/docs prompts:check` — pass.
- `aggregate-version-gate.log`: exact prompt files from the locked `mmrywqnp` source tree and current working head were copied into a disposable Git repository, then the real CLI ran with the temporary full SHA baseline/head pair. This is necessary because this workspace is jj-backed without a colocated Git worktree. It checks the exact baseline-to-current prompt source content, not the fake commit IDs as repository history.
- `browser.log`: refreshed built docs preview and Playwright run passed against Chromium 151.0.7922.34 at 390×844; screenshots are in `../browser/` and their hashes in `../browser/README.md`. The screenshots were visually inspected. This automated run is not desktop/manual acceptance or cross-browser acceptance.
- `preview.log`: Astro preview server output for the browser run.

Nx continued to report `@maelstrom-co/realtime-livekit-agent:build` as a flaky task during successful docs tests/builds; the docs targets themselves passed uncached.

## Outstanding acceptance

The follow-up runs are now preserved and assessed in [current-version replays](../replays/README.md). The read-only React Inventory uses the repaired `SearchPanel.tsx` fixture and is correctly marked read-only; its paired authorized conversion has four passing local tests. The new onboarding run and the two migration cases use current v1.0.0 prompt versions and locally bundled SDK packages. The historical modeling report is reused only because its complete instruction body, Queue input, checklist, and exact task hash match current sources; the historical report itself remains unchanged and is not relabeled as a new v1.0.0 run. The original reports in the parent run directory are preserved verbatim. All three new worker records remain `review-required`; prompt checklist results are limited to fixture-local evidence, not hosted or live integration acceptance.

Hosted CI/required-check enforcement, live Engine/provider behavior, production auth/transport behavior, and human desktop-browser/cross-browser acceptance remain unverified. These separate gaps are not inferred from the local trial or prior headless browser results; required independent review is still pending.
