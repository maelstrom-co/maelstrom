# Maelstrom agent skills

This directory is the portable, app-owned filesystem bundle for Maelstrom coding-agent skills. The canonical package root is `apps/docs/skills/`; obtain the **entire directory tree**, preserving relative paths, rather than copying only a `SKILL.md`. The files are plain Markdown and require no runtime package, registry installation, or repository-specific absolute path.

## Consumer entrypoint

Start here when selecting guidance: choose exactly one lead `SKILL.md` whose description matches the task. Its workflow owns the task and conditionally directs the reader to bundled references. Do not load every skill or combine the lead procedures. A standalone prompt can be used without a skill; skills do not assemble, modify, or supply prompt bodies. Follow the user's authorization: plan-only work stops at a plan, while explicitly authorized implementation proceeds after inspection unless inspection reveals a material unresolved decision.

| Task | Lead skill | Reference selection |
| --- | --- | --- |
| New integration or broad project orientation | [`maelstrom-project-onboarding/SKILL.md`](maelstrom-project-onboarding/SKILL.md) | Connector/auth only for custom transport or application authentication. |
| Select and model a user-visible capability as a Vessel | [`maelstrom-vessel-modeling/SKILL.md`](maelstrom-vessel-modeling/SKILL.md) | Actions/idempotence before exposing side effects or retry-sensitive operations. |
| Incrementally migrate an existing React capability | [`maelstrom-react-migration/SKILL.md`](maelstrom-react-migration/SKILL.md) | Vessel modeling for the selected contract; rollback before changing/removing the legacy path. |
| Diagnose an observed failure | [`maelstrom-debugging/SKILL.md`](maelstrom-debugging/SKILL.md) | Connector/auth for transport/auth evidence; state-sync for definition/update conflicts. |
| Add event reporting | [`maelstrom-observability/SKILL.md`](maelstrom-observability/SKILL.md) | Security before logging request data, credentials, or user content. |
| Update a Vessel definition or runtime state | [`maelstrom-state-sync/SKILL.md`](maelstrom-state-sync/SKILL.md) | Actions/idempotence if operations are added or removed. |
| Integrate voice when the product goal requires it | [`maelstrom-voice-integration/SKILL.md`](maelstrom-voice-integration/SKILL.md) | Browser/React, lifecycle/turn-taking, or deployment only for the selected concern; provider guidance only after selection. |

For a mixed request, use the lead matching its primary outcome; that skill may point to relevant references. These are task-selection conventions, not automated orchestration. When no task clearly matches, use the relevant standalone prompt or ask the user to narrow the task rather than loading several competing leads.

## Bundle inventory

The portable package consists of every Markdown file below this directory. Preserve the tree and resolve links relative to the linking file:

```text
apps/docs/skills/
├── README.md
├── maelstrom-project-onboarding/SKILL.md
├── maelstrom-vessel-modeling/SKILL.md
├── maelstrom-react-migration/SKILL.md
├── maelstrom-debugging/SKILL.md
├── maelstrom-observability/SKILL.md
├── maelstrom-state-sync/SKILL.md
├── maelstrom-voice-integration/SKILL.md
└── references/
    ├── actions-and-idempotence.md
    ├── browser-react.md
    ├── connectors-and-auth.md
    ├── debugging-evidence.md
    ├── provider-deployment.md
    ├── rollback.md
    ├── security-and-telemetry.md
    ├── state-sync.md
    ├── vessel-modeling.md
    └── voice-lifecycle-and-turn-taking.md
```

All mandatory workflow material is in this bundle. Maelstrom-specific API names must still be verified against the consumer project's installed exports, declarations, source, tests, and version-matched docs; the bundle is not a claim that an API exists in every SDK version. Voice references are optional and do not imply that a provider is selected or supported. No skill assumes repository-internal absolute paths, starts agents, or performs side effects without the task's authorization.
