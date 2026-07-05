export type Zone = 'browser' | 'server' | 'contract';

/** Hero nodes carry the runtime story; secondary nodes are the browser-side
 * build cluster, shown dimmed and revealed on demand. */
export type Tier = 'hero' | 'secondary';

export interface PackageNode {
  /** Stable id, also used in dependsOn references. */
  id: string;
  /** Display label (the published package name). */
  label: string;
  zone: Zone;
  tier: Tier;
  /** One-line role shown in the reveal panel. */
  role: string;
  /** Ids this package depends on at build time. */
  dependsOn: string[];
  /** Link to the in-depth page for this area. */
  deepDiveHref: string;
}

export const NODES: PackageNode[] = [
  {
    id: 'protocol',
    label: '@maelstrom-co/protocol',
    zone: 'contract',
    tier: 'hero',
    role: 'Shared types, Zod schemas, and the message contract both sides speak.',
    dependsOn: [],
    deepDiveHref: '/understanding/protocol/',
  },
  {
    id: 'engine',
    label: '@maelstrom-co/engine',
    zone: 'server',
    tier: 'hero',
    role: 'Server-side LLM decision core: turns context into an execution plan + layout directives.',
    dependsOn: ['protocol'],
    deepDiveHref: '/understanding/engine/',
  },
  {
    id: 'client',
    label: '@maelstrom-co/client',
    zone: 'browser',
    tier: 'hero',
    role: 'Framework-agnostic orchestration: sends requests to the engine and applies responses.',
    dependsOn: ['protocol'],
    deepDiveHref: '/understanding/llm-orchestration/',
  },
  {
    id: 'react',
    label: '@maelstrom-co/react',
    zone: 'browser',
    tier: 'secondary',
    role: 'React bindings: Provider, Chart, hooks, and vessel definitions.',
    dependsOn: ['client', 'protocol'],
    deepDiveHref: '/understanding/vessel-state-machine/',
  },
  {
    id: 'demo',
    label: '@maelstrom-co/demo',
    zone: 'browser',
    tier: 'secondary',
    role: 'Reference app that consumes the React bindings.',
    dependsOn: ['react', 'client', 'engine', 'protocol'],
    deepDiveHref: '/getting-started/quick-start/',
  },
];

export function nodeById(id: string): PackageNode | undefined {
  return NODES.find((n) => n.id === id);
}
