import type { PromptCollectionData } from '../../tools/prompts/collection-loader';

export interface PromptEntry {
  id: string;
  data: PromptCollectionData;
}

export const promptLabels: Record<string, string> = {
  'maelstrom-debugging': 'Debug a Maelstrom issue',
  'maelstrom-project-onboarding': 'Integrate Maelstrom into a project',
  'maelstrom-react-conversion': 'Convert a React capability',
  'maelstrom-react-inventory': 'Plan a React integration',
  'maelstrom-vessel-modeling': 'Model a capability as a Vessel',
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
