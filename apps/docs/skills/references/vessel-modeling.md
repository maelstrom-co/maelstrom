# Selecting and modeling a Vessel

A Vessel is a developer-authored UI capability the Engine can select and present, not a synonym for every UI component. Start from existing user-visible behavior and a plausible user intent. Explain the Engine value of choosing that capability as a unit. Keep controls, badges, loading indicators, and other implementation details inside it unless independently meaningful to users and the Engine.

Model only evidence-backed discrete, legal user-visible states as Variants and existing user operations as Actions. One useful Variant and no Actions is valid. Do not add states or operations to look agent-ready. Use product-language descriptions: descriptions are orchestration inputs. Record source/test evidence for props, minimum size, transitions, and handler ownership. Preserve the existing UI where practical and keep application state/effects in the application.

Verify `defineVessel`, React bindings, prop types, and any registration API against the consumer project's installed package exports, types, source, tests, or matching docs. Do not assume snippets from another release remain valid. See the [public Vessel guide](https://docs.maelstrom-ai.co/understanding/vessel-state-machine/) for user-facing concepts; installed version evidence governs API claims.
