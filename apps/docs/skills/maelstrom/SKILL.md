---
name: maelstrom
description: >-
  Entry point for Maelstrom development tasks. Inspect the requested outcome and
  installed @maelstrom-co packages, then select exactly one task procedure and,
  when available, the version-matched API guide shipped by that package. Useful
  before any Maelstrom SDK package is installed.
license: MIT
metadata:
  author: Maelstrom
  version: 0.1.1
---

# Maelstrom task router

Start here for any task involving Maelstrom. This entry skill is useful before
an SDK is installed: it explains task selection without assuming any package or
API exists.

1. Inspect the task and project instructions. Check the package manifest,
   lockfile, and installed `node_modules/@maelstrom-co/*/package.json` files.
   Record exact installed versions; do not infer APIs from current website docs,
   this skill bundle, or a different package version.
2. Select one procedure by the task's primary outcome. Load the procedure skill
   by its listed name using the selected agent's skill loader; follow that
   workflow and only the references it conditionally requires. When only this
    entry skill is installed and the procedure is not discoverable, report the
    missing procedure and its install command. Install it only when the user's
    task authorizes installation; plan-only work does not authorize changes.
3. If an API-specific step is needed and its package is installed, load the
   package-owned guide at
   `node_modules/@maelstrom-co/<package>/skills/<guide>/SKILL.md`. Treat the
   owning installed package's `package.json` version as authoritative; do not
   trust a duplicated version field in a guide. If the guide is not shipped by
   that exact installation, inspect installed exports, declarations, source and
   tests directly; do not use a guide from another version. If no Maelstrom SDK
   is installed, use the selected procedure for repository discovery and
   planning without inventing APIs.
4. Never load every procedure or combine competing workflows. For a mixed task,
   choose the procedure matching the primary result; consult a second procedure
   only when the first explicitly directs it. If no row fits, use relevant
   standalone documentation or ask the user to narrow the goal.

| Primary task outcome | Procedure |
| --- | --- |
| Introduce Maelstrom or choose a bounded first integration | `maelstrom-project-onboarding` |
| Model a user-visible capability as a Vessel | `maelstrom-vessel-modeling` |
| Incrementally migrate an existing React capability | `maelstrom-react-migration` |
| Diagnose a concrete runtime failure | `maelstrom-debugging` |
| Add event reporting or telemetry | `maelstrom-observability` |
| Update a Vessel definition or runtime state | `maelstrom-state-sync` |
| Add or change optional voice input | `maelstrom-voice-integration` |

The linked procedures are useful without an SDK installed, but public API details
must always come from the matching installed SDK guide or installed package
artifacts. Bundled voice architecture and ADR references are self-contained;
provider-specific documentation may still require current, selected-provider
sources.
