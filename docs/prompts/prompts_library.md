# Canonical prompt library

Standalone prompts are complete instructions for a coding agent. The published bodies have one source of truth: [`apps/docs/prompts/library/`](../../apps/docs/prompts/library/). Do not maintain copied prompt bodies in this planning page.

The docs site publishes the current library at [Prompts library](../../apps/docs/src/pages/agents/prompts/index.astro). Each prompt has a stable ID and metadata for its prompt version and declared SDK compatibility. Its detail page copies or downloads the full Markdown body without YAML frontmatter or page text. See the [prompt architecture and version contract](agentic_prompt_architecture.md) for the source and validation rules.

## Current prompt IDs

- [`maelstrom-connector-auth`](../../apps/docs/prompts/library/maelstrom-connector-auth.md) — connector and application authentication.
- [`maelstrom-debugging`](../../apps/docs/prompts/library/maelstrom-debugging.md) — evidence-led issue diagnosis.
- [`maelstrom-observability`](../../apps/docs/prompts/library/maelstrom-observability.md) — event reporting and telemetry.
- [`maelstrom-project-onboarding`](../../apps/docs/prompts/library/maelstrom-project-onboarding.md) — project assessment and onboarding.
- [`maelstrom-react-conversion`](../../apps/docs/prompts/library/maelstrom-react-conversion.md) — bounded React capability conversion.
- [`maelstrom-react-inventory`](../../apps/docs/prompts/library/maelstrom-react-inventory.md) — plan-only React inventory and migration plan.
- [`maelstrom-sdk-scaffold`](../../apps/docs/prompts/library/maelstrom-sdk-scaffold.md) — smallest working SDK integration shell.
- [`maelstrom-state-sync`](../../apps/docs/prompts/library/maelstrom-state-sync.md) — Vessel definition and runtime-state synchronization.
- [`maelstrom-testing`](../../apps/docs/prompts/library/maelstrom-testing.md) — Maelstrom integration testing.
- [`maelstrom-upgrade`](../../apps/docs/prompts/library/maelstrom-upgrade.md) — version-aware SDK upgrade.
- [`maelstrom-vessel-modeling`](../../apps/docs/prompts/library/maelstrom-vessel-modeling.md) — evidence-backed Vessel modeling.
- [`maelstrom-voice-integration`](../../apps/docs/prompts/library/maelstrom-voice-integration.md) — optional voice integration.

This list describes the current canonical inventory; filenames, titles, metadata, and bodies in the library remain authoritative. A related skill may guide a longer workflow, but does not assemble or modify a standalone prompt. See the [`apps/docs/skills/` consumer guide](../../apps/docs/skills/README.md).
