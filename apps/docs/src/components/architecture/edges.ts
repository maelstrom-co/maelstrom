import type { LoopStep } from './loop-machine';

/**
 * A connector drawn between two package nodes.
 * - `channel`: the runtime spine, client → protocol → engine. Drawn as two
 *   segments so the request/response visibly bends at the contract in the middle.
 * - `dependency`: a build-time edge in the browser-side cluster (dimmed). These
 *   are an illustrative subset, not the full dependency graph — each package's
 *   complete `dependsOn` set lives in nodes.ts (and surfaces in the reveal
 *   panel). Protocol's shared role is carried by the channel spine and the
 *   contract band rather than by drawing every package's edge into it.
 */
export interface Edge {
  id: string;
  from: string;
  to: string;
  kind: 'channel' | 'dependency';
}

export const EDGES: Edge[] = [
  { id: 'client-protocol', from: 'client', to: 'protocol', kind: 'channel' },
  { id: 'protocol-engine', from: 'protocol', to: 'engine', kind: 'channel' },
  // Dependency edges run from the dependency to the dependent (client provides
  // to react, react to demo), matching the `dependsOn` direction in nodes.ts.
  { id: 'client-react', from: 'client', to: 'react', kind: 'dependency' },
  { id: 'react-demo', from: 'react', to: 'demo', kind: 'dependency' },
];

/** Ordered node ids the request packet travels; the response runs it reversed. */
export const CHANNEL_PATH: readonly string[] = ['client', 'protocol', 'engine'];

export type EdgeDirection = 'forward' | 'reverse';

/**
 * Direction the runtime loop travels the channel at a given beat, or null when
 * nothing crosses the wire. The request leaves the client for the engine; the
 * response returns. Apply/observe beats happen inside the client.
 */
export function channelDirectionForStep(step: LoopStep): EdgeDirection | null {
  switch (step) {
    case 'request':
      return 'forward';
    case 'respond':
      return 'reverse';
    default:
      return null;
  }
}
