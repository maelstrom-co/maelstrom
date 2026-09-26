---
id: maelstrom-react-conversion
prompt_version: 1.0.1
compatibility:
  sdk:
    "@maelstrom-co/react": "0.1.0-alpha.4"
---

Implement the bounded React-to-Maelstrom conversion authorized below:

[APPROVED INVENTORY / PLAN]

Repository root: [PATH]
Authorized goal and limits: [GOAL AND LIMITS]

You are authorized to edit only the files necessary to implement this approved
plan. First inspect the current repository and verify that the approved plan still
matches the source. If source drift, missing evidence, an API/version mismatch,
or any material product, architecture, or scope decision prevents safe execution,
stop before editing that part and report the blocker. Do not quietly reinterpret
the authorization or expand it.

## Verify and preserve the existing behavior

1. Read package manifests and lockfile; record declared and resolved versions of
   all relevant `@maelstrom-co/*` dependencies. Read the installed SDK's source,
   types, docs, and tests for the APIs you intend to use. Do not copy stale sample
   code or assume compatibility outside evidence in this repository.
2. Inspect the selected component and callers, routes, state/data hooks or stores,
   API handlers, types, and relevant tests. Record the actual rendering, state,
   legal transitions, and effects before making changes.
3. Preserve existing rendering, routing, state ownership, and user-visible
   behavior except changes explicitly in the authorization. Preserve the
   application's existing auth/Connector ownership; never add provider
   credentials to browser code or move provider decisions to the client.

## Convert only the approved capability

- Define Variants only for observed, meaningfully distinct legal user-visible
  states, with evidence for each boundary. A useful single-Variant Vessel with no
  Actions is valid; don't invent extra states or Actions.
- Define Actions only for existing legal operations and only where available.
  Keep business and API effects in the existing application-owned handlers and
  preserve validation and confirmation behavior. Do not mark accumulating,
  destructive, or other side-effecting operations idempotent without evidence
  the underlying operation genuinely is idempotent. Do not invent deduplication,
  retry semantics, or idempotence keys.
- Use installed-version typed APIs; do not conceal an invalid definition with
  casts. Preserve existing component/rendering where practical. Keep controls and
  incidental implementation state inside the capability instead of exposing
  each as a Vessel.
- Register only the approved developer-authored Vessel(s) and make only the
  smallest authorized intent/integration change. Do not replace them with
  model-generated JSX. Preserve client-owned layout state while the Engine
  plans layout directives; neither the Engine nor browser rendering takes
  ownership of that client state.
- Do not widen into broad migration, voice, unrelated refactors, new auth, or
  inline overflow/size reconciliation.

## Verify and rollback

Add or update tests for selected Variant rendering and each exposed Action's
legal boundary and handler effect. Run relevant project typecheck, tests, and
lint/format checks; give exact commands and outcomes. Do not claim that a stub,
static check, or local test verifies live Engine behavior. If live Engine
verification needs separately configured infrastructure, say so.

Before reporting, inspect the complete diff for secrets, unrelated changes, and
behavior changes. Give a rollback path naming the precise changed files and
reversal steps. If checks fail, report the failures rather than describing them
as passed; do not broaden scope to silence them.

## Report

Return observed versions and behavior, changed files and bounded implementation,
test coverage, exact verification results, Connector/credential and state/effect
ownership review, live-service limitations, and rollback instructions. Distinguish
verified facts from unresolved assumptions.
