# Prompt trial review — 2026-09-26

These records capture five actual coding-agent trials against disposable copies of the `acceptance-fixtures-v1` inputs. They are not fixture unit tests and do not establish live provider/Engine behavior. The original trial reports are preserved verbatim alongside this review. Trial reports do not name the evaluator or exact wall-clock run date; the directory date is based on the report artifact timestamps (Sep 26, 2026), not an independently recorded trial timestamp. Evaluator identity: **not recorded**. The applicable checklists are linked below.

Repository source revision used: `smvmlwkxlmkloozuxlsywvnoopruqwrz` (`f50ec0c286a6750c6ddc5303719ce6e6d961f237`, inventory checklist addition). Fixture revision: `acceptance-fixtures-v1`. Disposable trial workspace root recorded in reports: `/tmp/maelstrom-prompt-acceptance.0ncOs4`. The canonical prompt versions and compatibility declarations below are from reports; declared compatibility is not installed SDK evidence. All five identify `@maelstrom-co/react` `0.1.0-alpha.4` as canonical compatibility; actual SDK resolution was absent in the fixtures.

| Trial / record | Prompt version; exact task | Checklist assessment | Outcome / limitations |
|---|---|---|---|
| [Onboarding](onboarding.md) | `maelstrom-project-onboarding` 1.0.0. Goal: integrate the support queue as a developer-authored Vessel, inspect app/SDK first, preserve heading/text/tickets, report setup/versions/checks/rollback; no credentials or live Engine claim. | Checklist: criteria 1–6 **pass for inspection/scope/reporting only**; criterion 7 **pass as reporting**, with typecheck pass, build fail, tests/lint/live checks unrun. Actual integration acceptance **unrun**. | Correctly stopped before edits because fixture could not resolve React runtime or SDK; `npm run build` failed resolving `react`, TypeScript passed but is not runtime proof. No test script, no API validation, no implementation, no live Engine. Setup repair and a fresh authorized run required. |
| [Vessel modeling](modeling.md) | `maelstrom-vessel-modeling` 1.0.1. Read-only inventory/proposal for `src/Queue.tsx`, identify states/operations and whether one Vessel. | Checklist criteria 1–7 **pass** for the read-only proposal. | Evidence-backed proposal accurately reports local filtering, empty-results state and reset. No implementation checks apply. SDK absent, so no API/installed-version claim; no live Engine. |
| [React inventory](react-inventory.md) | `maelstrom-react-inventory` 1.0.0. Read-only plan to make `src/App.tsx` support queue a developer-authored Vessel without behavior changes. | Checklist criteria 1–7 **pass** for read-only planning and observed evidence. | Fixture unchanged and checksums match. Safely defers API plan pending SDK. React/React DOM are unmet from the linked shared dependencies; no lockfile. Project checks and live behavior unrun. |
| [Authorized conversion](authorized-conversion.md) | `maelstrom-react-conversion` 1.0.1. Approved conversion limited to `src/SearchPanel.tsx` and demonstrated local registration/test seam; preserve behavior/owner; no request or installs. | Checklist 1, 3–5, 7 **pass for scope/no-request/reporting**; criteria 2 and 6 **unrun** because conversion did not occur. | Correctly stopped before edits: fixture lacks installed SDK, manifest, registration seam and tests. Source repo was consulted read-only for SDK evidence only. No typecheck/tests/live Engine. This is blocked, not conversion success or prompt failure. |
| [Evidence-based debugging](evidence-debugging.md) | `maelstrom-debugging` 1.0.0. Diagnose the supplied `report.md`; separate facts/inferences, identify gaps, recommend bounded diagnostic step, no edits. | Checklist criteria 1–7 **pass** for supplied synthetic evidence and diagnose-only authority. | Correctly classifies distinct `req-browser-17` transport refusal and `req-server-42` provider timeout. Source report is synthetic; not live transport/Engine evidence. SDK version unavailable in fixture. |

## Per-checklist statuses

Statuses assess observed prompt/trial behavior against the checklist, not the product feature's final completion.

- **Onboarding** (`checklists/onboarding.md`): 1 pass (declared/resolved SDK both absent, accurately distinguished); 2 pass (support queue and both tickets cited); 3 pass for inspect-before-edit/stop boundaries, implementation itself unrun; 4 pass (no API invented; deferred pending installed package); 5 pass (no invented actions/states/live claim); 6 pass for preserving the baseline by making no edits; 7 pass for reporting checks/rollback. Actual fixture commands: typecheck pass; build **fail** (React unresolved); tests/lint/live checks **unrun**.
- **Modeling** (`checklists/modeling.md`): criteria 1–7 pass in the trial report, with source-linked behavior table, proposal-only/no-edit authority, exact limits, and no Engine claim. Implementation/rendering tests **not applicable** (not authorized); SDK/type/API/live Engine checks **unrun**.
- **Inventory** (`checklists/inventory.md`): criteria 1–7 pass for the read-only plan and report. Fixture stayed unchanged per recorded checksums. SDK install/type/API/build/tests and live Engine **unrun/unavailable**; typecheck/build cannot be counted as passes.
- **Authorized conversion** (`checklists/migration.md`): 1 pass (approved scope inspected and no mismatch-driven expansion); 2 **unrun** (no patch was applied); 3 pass (no request; app-owned handler untouched); 4 pass (stub boundary untouched); 5 pass (no retry/idempotence assertion); 6 **unrun** (implementation tests cannot exist without implementation); 7 pass (blocker, checks, limitations and rollback recorded). Conversion acceptance is **blocked/unrun**, not passed.
- **Debugging** (`checklists/debugging.md`): criteria 1–7 pass for the synthetic supplied report, including separate IDs, unknown evidence, diagnose-only scope and no credential request. Live failure classification and provider/Engine behavior remain **unrun**.

## Exact task inputs and SDK evidence

The full task wording is preserved in the corresponding report and prep record. The onboarding task includes the product goal “Integrate Maelstrom into this small support workspace so the support queue can be selected and presented as a developer-authored Vessel.” The modeling goal is “Inventory the support-queue capability; identify observed user-visible states and operations, decide whether it should be one Vessel, and give an evidence-backed proposal.” Inventory goal: “Plan how to make the support queue in `src/App.tsx` available as a developer-authored Maelstrom Vessel without changing current behavior.” Conversion used the approved plan limited to the search panel, retaining app-owned request handling and making no request. Debugging classified the two supplied synthetic failures without merging them. See each actual report for the precise substitutions, inspected files, command outcomes and observations.

All report artifacts record prompt compatibility declaration `@maelstrom-co/react` `0.1.0-alpha.4`; absent fixture SDK installation is consistently reported as absent, not treated as that version. Debugging report additionally notes repository source package metadata `0.1.0-alpha.4` versus `bun.lock` workspace entry `0.1.0-alpha.3`. That discrepancy is not a resolved fixture dependency version and does not change the trial's synthetic status.

## Browser UI acceptance

The local docs preview was exercised in headless Chromium by the separate [browser check](browser/README.md), not manually on a desktop browser. All five prompt details, metadata, index routes, guide destinations, keyboard focus/Enter activation, clipboard equality, versioned download names, and downloaded bytes passed at 390×844; screenshots and downloaded artifacts are checked in with SHA-256. The screenshots were opened and inspected. This is browser-driven UI evidence, not a model trial, provider/Engine verification, or cross-browser guarantee. No human desktop-browser clipboard/download session was run.

## Integration checks

Final docs project checks ran uncached after the added evidence files: `bunx nx run @maelstrom-co/docs:typecheck --skip-nx-cache` (0 errors, 0 warnings, 181 existing hints), `test` (203 pass, 0 fail), `check` (Biome checked 102 files), and `build` (523 pages). The Nx summary flags the existing `@maelstrom-co/realtime-livekit-agent:build` as flaky even though the dependency and requested targets completed successfully. `bun run --cwd apps/docs prompts:check` passed the source schema check. The prompt library exact-revision CLI was also exercised in a throwaway Git repo with the workflow's `bun run prompts:check -- <base-sha> <head-sha>` argument shape: same-version body edits were rejected, then accepted after a semver bump. The unit suite covers schema/body/version fixtures, exact Git revisions, and the exported app CLI.

One preliminary `check` failed only because the new one-off browser runner had not yet been Biome formatted; it was formatted, rerun successfully against the preview, and the final check passed. The locked architecture SHA-256 remained `34c0e1bf3cbd15b9b1b694b287fee118963aa484e7def409bc92bf4e129f0b6b`. No hosted CI/required-check state was claimed or modified.

## Reproducibility and hashes

Reports preserve each trial's actual commands and outcomes; commands from isolated trial environments cannot be rerun verbatim unless those temporary workspaces still exist. The reports include workspace paths, fixture revision, prompt IDs/versions, observed dependency evidence, and any file checksum comparison available. Trial artifacts were copied byte-for-byte from the supplied output paths. SHA-256:

```text
a1da6814276aa9ad1f500ac956b1b29e05d5dfb8e51f143516b05b8e0f58a813  authorized-conversion.md
a2c79ad1189ac596e96ec4e0b6946f93aca56d858f98374df5c95269cd930b86  evidence-debugging.md
5d2173d2ecc3f182cb56fec3d259521fd2d76218a25cb70fe72463220870b6a4  modeling.md
fdb364c4a5a85df01b51d9b6d08d3272c50b69363e57b44bdf09aaaff92fc7cb  onboarding.md
d79c08fa4abf7b6652f594305cb99e07abaf6edeb2665129e0274989350db44c  react-inventory.md
```

No source fixture was edited by these trials. P1 additional task prompts/skills/voice and P2 automated behavioral framework remain deferred.
