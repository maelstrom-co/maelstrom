import type { EngineConnector, Orchestrator } from '@maelstrom-co/client';
import type { MutableRefObject } from 'react';

import type { ResolvedMaelstromConfig } from './config-types.js';

/**
 * Stable shape passed to extensions when they read context from inside a
 * Provider tree. Deliberately narrower than the internal context value
 * so extension authors do not couple to private bookkeeping (component
 * registry, vessel entries, mount guards) that may be reshaped between
 * minor versions.
 */
export interface MaelstromExtensionContextValue {
  orchestrator: Orchestrator;
  connector: EngineConnector;
  config: ResolvedMaelstromConfig;
  /** Ref to onError callback from Provider props. Lets extensions surface errors without re-renders. */
  onErrorRef: MutableRefObject<((error: Error) => void) | undefined>;
}

/**
 * Context handle handed to a `MaelstromExtension`. Exposes a hook that,
 * when called inside the matching Provider tree, returns the stable
 * extension-context subset. The actual runtime object carries more
 * fields, but only those listed here are part of the supported contract.
 */
export interface MaelstromExtensionContext {
  useMaelstromContext: () => MaelstromExtensionContextValue;
}

/**
 * Constraint for extension factory return values. Restricts the shape to a
 * plain object — the `{ then?: never }` clause rejects `Promise<...>` so an
 * accidentally-async factory (`async (ctx) => ({...})`) fails at compile
 * time instead of silently spreading a thenable onto the instance.
 */
export type ExtensionOutput = object & { then?: never };

/**
 * Factory function that receives the extension context and returns
 * additional fields to be merged onto the `MaelstromInstance`.
 *
 * Extension authors implement this type to create addons (voice, analytics,
 * devtools, etc.) and consumers apply them via `instance.with(extension)`.
 *
 * Extensions must return a plain object synchronously. Async factories,
 * arrays, and primitive values are rejected at compile time via the
 * `ExtensionOutput` constraint.
 *
 * @example
 * const myExtension: MaelstromExtension<{ greet: () => string }> = (ctx) => ({
 *   greet: () => 'Hello from extension!',
 * });
 *
 * const m = createMaelstrom({ vessels }).with(myExtension);
 * m.greet(); // 'Hello from extension!'
 */
export type MaelstromExtension<Out extends ExtensionOutput> = (
  ctx: MaelstromExtensionContext,
) => Out;
