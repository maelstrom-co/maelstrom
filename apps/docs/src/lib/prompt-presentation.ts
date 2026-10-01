import type { PromptCollectionData } from '../../tools/prompts/collection-loader';

export interface PromptEntry {
  id: string;
  data: PromptCollectionData;
}

export const promptLabels: Record<string, string> = {
  'maelstrom-connector-auth': 'Design connector and app authentication',
  'maelstrom-debugging': 'Debug a Maelstrom issue',
  'maelstrom-observability': 'Add focused event observability',
  'maelstrom-project-onboarding': 'Integrate Maelstrom into a project',
  'maelstrom-react-conversion': 'Convert a React capability',
  'maelstrom-react-inventory': 'Plan a React integration',
  'maelstrom-sdk-scaffold': 'Scaffold an SDK integration',
  'maelstrom-state-sync': 'Synchronize Vessel state and definitions',
  'maelstrom-testing': 'Test migration parity',
  'maelstrom-upgrade': 'Upgrade Maelstrom SDK packages',
  'maelstrom-vessel-modeling': 'Model a capability as a Vessel',
  'maelstrom-voice-integration': 'Integrate voice (optional)',
};

export function sortPrompts(entries: PromptEntry[]): PromptEntry[] {
  return [...entries].sort((a, b) => a.id.localeCompare(b.id));
}

export function promptRoutes(entries: PromptEntry[]) {
  return entries.map((entry) => ({
    params: { id: entry.id },
    props: { entry },
  }));
}

export function promptLabel(id: string): string {
  return promptLabels[id] ?? id;
}
