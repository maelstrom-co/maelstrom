import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface CodeBlock {
  title: string;
  source: string;
}

/** Read titled TypeScript examples without keeping their surrounding MDX. */
export function titledExamples(markdown: string): CodeBlock[] {
  return [
    ...markdown.matchAll(
      /^[ \t]*(`{3,})(?:ts|tsx)[^\n]*title="([^"]+)"[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm,
    ),
  ].map((match) => ({ title: match[2], source: match[3] }));
}

function required(blocks: CodeBlock[], title: string): string {
  const block = blocks.find((entry) => entry.title === title);
  if (!block) throw new Error(`Missing authored example: ${title}`);
  return block.source;
}

/** Assemble the documented stages and explicit application-owned seams. */
export async function collectAuthoredExamples(
  root: string,
): Promise<Map<string, string>> {
  const read = async (path: string) =>
    titledExamples(
      await readFile(
        join(root, 'apps/docs/src/content/docs/dev', path),
        'utf8',
      ),
    );
  const quickStart = await read('getting-started/quick-start.mdx');
  const vessels = await read('guides/react/creating-vessels.mdx');
  const actions = await read('guides/react/variants-and-actions.mdx');
  const engine = await read('understanding/engine.mdx');
  const files = new Map<string, string>();
  for (const title of [
    'src/components/Greeting.tsx',
    'src/vessels/greeting.tsx',
    'src/maelstrom.ts',
    'src/App.tsx',
    'src/IntentBar.tsx',
  ]) {
    files.set(`quick-start/${title}`, required(quickStart, title));
  }
  for (const title of [
    'src/vessels/greeting/greeting.vessel.ts',
    'src/vessels/greeting/greeting.component.tsx',
    'src/maelstrom.ts',
    'src/app.tsx',
  ]) {
    files.set(`vessels/${title}`, required(vessels, title));
  }
  files.set(
    `vessels/src/connector.ts`,
    `import { WebSocketConnector } from '@maelstrom-co/react';
export const myConnector = new WebSocketConnector({ url: 'ws://localhost:3001/ws' });
`,
  );
  const releasedAction = 'sdk-0.2.1/greeting.tsx';
  files.set(releasedAction, required(actions, releasedAction));
  files.set('engine.ts', required(engine, 'Configuring the engine'));
  return files;
}
