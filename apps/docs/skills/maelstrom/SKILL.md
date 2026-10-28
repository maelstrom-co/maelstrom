---
name: maelstrom
description: >-
  Entry point for Maelstrom development, starting a new app, integrating an
  existing app, and voice testing. Ask for missing task context, then select
  exactly one procedure. For SDK work, check installed @maelstrom-co packages
  and their version-matched API guides. Useful before any SDK is installed.
license: MIT
metadata:
  author: Maelstrom
  version: 0.2.0
---

# Maelstrom task router

Start here for any task involving Maelstrom. This entry skill is useful before
an SDK is installed: it explains task selection without assuming any package or
API exists.

1. Establish the goal from the conversation. For onboarding, establish whether
   the user is starting a new app or integrating an existing one. Ask only for
   missing answers; reuse context already supplied. For other tasks, ask for
   the task context needed to proceed. Clarify plan-only versus implementation
   only when the task leaves that undecided. An empty directory is a valid
   new-project starting point; it does not authorize replacing an existing app.
2. Inspect the task and project instructions. For SDK work, check the package
   manifest, lockfile, and installed `node_modules/@maelstrom-co/*/package.json`
   files. Record exact installed versions; do not infer APIs from current website
   docs, this skill bundle, or a different package version. Testing through the
   external Voice DevTools desktop MCP instead uses its connected tool schemas
   and workflow; no Maelstrom SDK installation is required.
3. Select one procedure by the task's primary outcome. Load the procedure skill
   by its listed name using the selected agent's skill loader; follow that
   workflow and only the references it conditionally requires. When only this
    entry skill is installed and the procedure is not discoverable, report the
    missing procedure and its install command. Install it only when the user's
    task authorizes installation; plan-only work does not authorize changes.
4. If an API-specific step is needed and its package is installed, load the
   package-owned guide at
   `node_modules/@maelstrom-co/<package>/skills/<guide>/SKILL.md`. Treat the
   owning installed package's `package.json` version as authoritative; do not
   trust a duplicated version field in a guide. If the guide is not shipped by
   that exact installation, inspect installed exports, declarations, source and
   tests directly; do not use a guide from another version. If no Maelstrom SDK
   is installed, use the selected procedure for repository discovery and
   planning without inventing APIs.
5. Never load every procedure or combine competing workflows. For a mixed task,
   choose the procedure matching the primary result; consult a second procedure
   only when the first explicitly directs it. If no row fits, use relevant
   standalone documentation or ask the user to narrow the goal.

| Primary task outcome | Procedure |
| --- | --- |
| Start a new app, introduce Maelstrom, or choose a bounded first integration | `maelstrom-project-onboarding` |
| Model a user-visible capability as a Vessel | `maelstrom-vessel-modeling` |
| Incrementally migrate an existing React capability | `maelstrom-react-migration` |
| Diagnose a concrete runtime failure | `maelstrom-debugging` |
| Add event reporting or telemetry | `maelstrom-observability` |
| Update a Vessel definition or runtime state | `maelstrom-state-sync` |
| Add or change optional voice input | `maelstrom-voice-integration` |
| Benchmark, stress, and test voice through a connected Voice DevTools desktop MCP | `maelstrom-voice-devtools` |

The linked procedures are useful without an SDK installed, but public API details
must always come from the matching installed SDK guide or installed package
artifacts. Bundled voice and general architecture references are self-contained;
provider-specific documentation may still require current, selected-provider
sources.
