# React migration guidance

This page preserves the incremental, reversible migration rationale. It is planning guidance, not a second prompt library: the canonical prompt bodies live only in [`apps/docs/prompts/library/`](../../apps/docs/prompts/library/). The shipped React migration flows are [`maelstrom-react-inventory`](../../apps/docs/prompts/library/maelstrom-react-inventory.md) (plan-only) and [`maelstrom-react-conversion`](../../apps/docs/prompts/library/maelstrom-react-conversion.md) (bounded implementation after inspection, under its stated authorization). The [`maelstrom-react-migration` lead skill](../../apps/docs/skills/maelstrom-react-migration/SKILL.md) provides the reusable workflow and points to references conditionally.

Headings below describe useful planning concerns, not additional published prompt IDs or separately shipped workflow stages. Follow the canonical prompt and skill when performing the task; do not treat an example here as authorization or as an authoritative copy of their instructions.

## Preserve an incremental and reversible path

A migration should avoid a big-bang rewrite. Inventory the existing application and behavior, choose a bounded capability, establish its Vessel contract, and preserve a route or feature boundary that allows the legacy behavior to remain available while the new path is evaluated. The exact stage order and scope depend on the repository; the prompt and skill require inspection rather than assuming a fixed implementation plan.

A Vessel is not synonymous with a React component. Select a user-visible capability the Engine can meaningfully present, grounded in observed behavior and plausible user intent. Keep implementation details inside that capability unless they are independently meaningful. A single-Variant Vessel with no Actions is valid; do not invent states or operations.

## Keep authorization explicit

The inventory prompt is plan-only: inspect and return findings and a migration plan without editing code. The conversion prompt describes the authorized implementation boundary after inspection. Follow the authorization in the selected canonical prompt and the user's request; do not infer permission from a heading or illustrative example on this page.

Do not conflate inventory with conversion. A skill may guide the broader migration and conditionally direct the agent to Vessel modeling, Actions/idempotence, or rollback references. It does not silently broaden authorization or require loading every reference for every task.

## Keep the legacy boundary until replacement is authorized

During an incremental migration, preserve existing behavior and keep a rollback boundary appropriate to the application. Before removing a legacy route or disabling an established behavior, inspect the actual release mechanism and obtain the authorization required for that change. Define parity and health checks from the product behavior and available test setup; do not treat proposed rollout examples as implemented infrastructure or completed validation.

Useful concerns to consider during planning include behavior parity, Action side effects and retry risk, connector/auth boundaries, failure reporting, tests, and rollback. Select only the concerns relevant to the inspected migration and consult the lead skill's conditional references. Behavioral evaluation of the prompt/skill library itself remains deferred; this page does not assert that sample-project runs or a written acceptance checklist have been completed.
