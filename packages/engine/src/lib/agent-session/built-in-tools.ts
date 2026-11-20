import { changeScreenToolEntry } from './change-screen-tool.js';
import type { ToolRegistry, ToolRegistryEntry } from './tool-registry.js';

/** Tool names the Engine keeps for its built-in tools. A user tool may not take one. */
export const RESERVED_TOOL_NAMES: readonly string[] = [
  'change_screen',
  'describe_capabilities',
];

/** The built-in tools every Agent Run offers beside the registry, in offer order. */
export const BUILT_IN_TOOLS: readonly ToolRegistryEntry[] = [
  changeScreenToolEntry,
];

/**
 * A registry that also knows the built-in tools, so policy and argument
 * checks treat them as known. `entries` still lists only the user tools.
 */
export function withBuiltInTools(registry: ToolRegistry): ToolRegistry {
  const builtIns = new Map(
    BUILT_IN_TOOLS.map((entry) => [entry.tool.name, entry]),
  );
  return {
    get: (name) => registry.get(name) ?? builtIns.get(name),
    entries: () => registry.entries(),
  };
}
