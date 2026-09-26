# Definition and runtime state synchronization

First establish who owns each value and whether the requested change affects Instance Variant/props, a Vessel definition, or layout. Inspect how the Vessel was registered, whether live Instances use the definition being changed, and whether an update is already in flight.

Select the version-supported path: factory-aware update for factory-declared Vessels, or the retained registration handle/update path for runtime-registered Vessels. Confirm method names, batching, and conflict behavior from installed exports, declarations, source, and tests. Preserve supported UpdateCoordinator batching; do not reimplement internals without a deliberate lower-level integration.

Handle removed Variants/Actions and in-flight updates explicitly; do not silently drop or force conflicts absent an authorized product policy. The client owns layout. Process Engine responses atomically: apply `set_layout` before `execute_actions`, so an Action may target an Instance introduced by that same response. Do not add inline overflow/size reconciliation; a whole Chart dimension change uses the existing resize request path. Use real test-created Instance IDs in deterministic layout assertions. Leave unknown conflict policy as an explicit question.
