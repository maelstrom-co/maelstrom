import type { MaelstromContextPair, MaelstromContextValue } from './context.js';

type RequireContextCaller =
  | 'registerVessel'
  | 'unregister'
  | 'updateVessel'
  | 'handle.update';

/**
 * Reads the Provider-synced context ref for the non-hook APIs — these call
 * sites are plain functions, not hooks, and cannot use `useContext`.
 */
export function requireContext(
  contextRef: MaelstromContextPair['contextRef'],
  caller: RequireContextCaller,
): MaelstromContextValue {
  const ctx = contextRef.current;
  if (!ctx) {
    throw new Error(
      `[Maelstrom] ${caller}() must be called while a <Provider> from the same createMaelstrom() instance is mounted.`,
    );
  }
  return ctx;
}
