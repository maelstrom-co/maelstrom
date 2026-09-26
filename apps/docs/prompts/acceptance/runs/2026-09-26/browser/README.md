# Built docs prompt UI check — 2026-09-26

This is browser-driven local preview evidence for the presentation routes and controls, separate from coding-agent fixture trials. Evaluator identity was not recorded for the upstream trial batch; this browser run was executed by the integration owner in the current workspace. No provider/Engine behavior was exercised. Browser interaction is automated with Playwright; screenshots were opened and visually inspected after the run.

- Prompt sources: five canonical records under `apps/docs/prompts/library`; versions are shown on index/detail pages.
- Site: fresh local `apps/docs/dist` output from `bunx nx run @maelstrom-co/docs:build --skip-nx-cache`.
- Preview: `http://127.0.0.1:4317`, started with `cd apps/docs && bun ./node_modules/.bin/astro preview --host 127.0.0.1 --port 4317`.
- Browser: Chromium `151.0.7922.34` (Playwright `1.62.1`), headless, viewport `390×844`; granted clipboard read/write only for localhost.
- Runner: from workspace root, `bun apps/docs/prompts/acceptance/runs/2026-09-26/browser-check.ts`.
- Result: **pass** for HTTP 200 index/detail routes; index links to all five IDs; exact base64 raw-body transport alongside rendered Markdown headings/lists/tables (including tables on React Inventory and Vessel Modeling); metadata remains outside rendered prompt content; no horizontal viewport overflow; keyboard focus and Enter activation of Copy/Download; actual clipboard content equals raw body; suggested download filename and downloaded bytes equal `${id}-v${prompt_version}.md` and canonical body. The three guide pages (Quick Start, Creating Vessels, Error Handling) each loaded and their prompt links returned HTTP 200.
- Visual screenshots: [`prompt-index-mobile.png`](prompt-index-mobile.png) and [`onboarding-detail-mobile.png`](onboarding-detail-mobile.png), captured from the 390px viewport and visually inspected. The previous-run screenshots and README are retained verbatim under [`pre-review/`](pre-review/).

## Captured download artifacts

Each `.md` file is the actual downloaded response saved by Playwright, not a generated copy. Byte lengths and SHA-256:

```text
maelstrom-debugging.md 2743 8aa1ffe58e7e7fb4743762961d8e37ca9dcd8b83b5d14dbd5c3530c7d48ab9e4
maelstrom-project-onboarding.md 3218 5bc8c8a9e86004acc6e2fe7261067f4a3db58efe324461e06778b27c54ffdc87
maelstrom-react-conversion.md 3865 93e948cd788d7b61c5cdf8ab5ff9fcd8c7b80defe714d6ca7256a7410ea9964e
maelstrom-react-inventory.md 4205 f9cbabbeac6efa67136522ad02b018c5abee9c3d03f209f8f71ce0ff0086816a
maelstrom-vessel-modeling.md 3452 2eb9d7afbb9366c7d1718cb465b0b2be8df83e553f1f69d8235bfc9349645f27
```

Screenshot SHA-256:

```text
onboarding-detail-mobile.png e510e6c574a14a70dc1f19efad0f39d51e46c9d56a30dc25ac9017b4a54f43af
prompt-index-mobile.png 214dc6a281d34c052a4f0ab311bc2fb06a6b7553c41212c273fef0b5cd444ec5
```

The runner performs actual preview interaction and records downloaded artifacts, but it is not wired into a project test target. This does not establish cross-browser compatibility or substitute for hosted CI. Clipboard was tested with browser permissions in headless Chromium, not manually on a user desktop.
