# Prompt trial review — 2026-09-26

These records capture the five original coding-agent trials against disposable copies of the `acceptance-fixtures-v1` inputs. They are not fixture unit tests and do not establish live provider/Engine behavior. Their reports remain verbatim historical records. Three fresh current-v1.0.0 trials and the narrowly justified modeling/debugging evidence reuse are assessed separately in [current-version replays](replays/README.md); do not substitute the historical table below for those results. Original trial reports do not name the evaluator or exact wall-clock run date; the directory date is based on report artifact timestamps (Sep 26, 2026), not an independently recorded trial timestamp. Original evaluator identity: **not recorded**. The applicable checklists are linked below.

## Review corrections and evidence validity

The aggregate initial-version check found that `maelstrom-react-conversion` and `maelstrom-vessel-modeling` were introduced as 1.0.1 even though neither ID exists at the locked baseline. Their canonical versions are corrected to 1.0.0 in the follow-up fix; the Markdown bodies are unchanged. The original reports remain verbatim historical evidence for the exact 1.0.1 metadata they read and do **not** claim trials under corrected current versions. The current-version replays and explicitly justified reuse are recorded separately in [replays](replays/README.md). The browser interaction evidence is regenerated from current v1.0.0 sources and versioned download names.

The historical `maelstrom-vessel-modeling` trial read v1.0.1 metadata. Its full body hash, Queue fixture, checklist, and exact task input match the current v1.0.0 case; reuse its read-only behavioral evidence without relabeling the historical report as a v1.0.0 run. The prior `maelstrom-react-inventory` report evaluated the support-queue onboarding fixture and remains historical evidence only; it is not the migration `SearchPanel.tsx` inventory. The repaired-fixture onboarding, paired migration inventory, and authorized-conversion trial records are now documented separately in [replays](replays/README.md). Their fixture-local results do not prove live or hosted integration, and the overall acceptance remains blocked pending independent review.

Repository source revision used: `smvmlwkxlmkloozuxlsywvnoopruqwrz` (`f50ec0c286a6750c6ddc5303719ce6e6d961f237`, inventory checklist addition). Fixture revision: `acceptance-fixtures-v1`. Disposable trial workspace root recorded in reports: `/tmp/maelstrom-prompt-acceptance.0ncOs4`. The canonical prompt versions and compatibility declarations below are from reports; declared compatibility is not installed SDK evidence. All five identify `@maelstrom-co/react` `0.1.0-alpha.4` as canonical compatibility; actual SDK resolution was absent in the fixtures.

The following table and per-checklist section assess only the five original reports; the linked current-version replay record is the status update for the follow-up trials.

| Trial / record | Prompt version; exact task | Checklist assessment | Outcome / limitations |
|---|---|---|---|
| [Onboarding](onboarding.md) | `maelstrom-project-onboarding` 1.0.0. Goal: integrate the support queue as a developer-authored Vessel, inspect app/SDK first, preserve heading/text/tickets, report setup/versions/checks/rollback; no credentials or live Engine claim. | Checklist: criteria 1–6 **pass for inspection/scope/reporting only**; criterion 7 **pass as reporting**, with typecheck pass, build fail, tests/lint/live checks unrun. Actual integration acceptance **unrun**. | Correctly stopped before edits because fixture could not resolve React runtime or SDK; `npm run build` failed resolving `react`, TypeScript passed but is not runtime proof. No test script, no API validation, no implementation, no live Engine. Setup repair and a fresh authorized run required. |
| [Vessel modeling](modeling.md) | Historical report read `maelstrom-vessel-modeling` 1.0.1 metadata. Current source is 1.0.0; the body hash, fixture, checklist and task input are unchanged ([reuse provenance](replays/README.md)). Read-only inventory/proposal for `src/Queue.tsx`. | Checklist criteria 1–7 **pass** for the read-only proposal; reuse is limited to unchanged instruction body and inputs. | Evidence-backed proposal accurately reports local filtering, empty-results state and reset. No implementation checks apply. SDK absent, so no API/installed-version claim; no live Engine. No duplicate trial required. |
| [React inventory](react-inventory.md) | `maelstrom-react-inventory` 1.0.0. Read-only plan to make `src/App.tsx` support queue a developer-authored Vessel without behavior changes. | Checklist criteria 1–7 **pass** for read-only planning and observed evidence. | Fixture unchanged and checksums match. Safely defers API plan pending SDK. React/React DOM are unmet from the linked shared dependencies; no lockfile. Project checks and live behavior unrun. |
| [Authorized conversion](authorized-conversion.md) | `maelstrom-react-conversion` 1.0.1. Approved conversion limited to `src/SearchPanel.tsx` and demonstrated local registration/test seam; preserve behavior/owner; no request or installs. | Checklist 1, 3–5, 7 **pass for scope/no-request/reporting**; criteria 2 and 6 **unrun** because conversion did not occur. | Correctly stopped before edits: fixture lacks installed SDK, manifest, registration seam and tests. Source repo was consulted read-only for SDK evidence only. No typecheck/tests/live Engine. This is blocked, not conversion success or prompt failure. |
| [Evidence-based debugging](evidence-debugging.md) | `maelstrom-debugging` 1.0.0. Diagnose the supplied `report.md`; separate facts/inferences, identify gaps, recommend bounded diagnostic step, no edits. | Checklist criteria 1–7 **pass** for supplied synthetic evidence and diagnose-only authority. | Correctly classifies distinct `req-browser-17` transport refusal and `req-server-42` provider timeout. Source report is synthetic; not live transport/Engine evidence. SDK version unavailable in fixture. |

## Per-checklist statuses

The statuses below assess the original historical prompt/trial behavior against its checklist, not the current replay or the product feature's final completion. See [replays](replays/README.md) for the current status.

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

The prior narrow integration-fix slice passed uncached docs typecheck, tests, `check`, and build; its exact counts and logs are preserved in [review-fixes](review-fixes/README.md). Those results predate the current replay archive and are not reused as its final verification. The new post-archive docs gate run, captured in the external `final-fixes.md` handoff, is the final verification for this evidence update. No hosted CI/required-check state is claimed or modified.

The narrow review follow-up, current-source browser run, preserved logs, and outstanding independent-review/external-validation status are recorded in [review-fixes](review-fixes/README.md) and [replays](replays/README.md). Passing local docs and fixture checks do not replace the required independent acceptance review or establish live/hosted behavior.

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
