import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import { build, type Plugin } from 'vite';

type Chunk = {
  readonly type: 'chunk';
  readonly fileName: string;
  readonly imports: readonly string[];
  readonly isEntry: boolean;
  readonly modules: Readonly<Record<string, unknown>>;
};

type BundleGraph = {
  readonly modules: readonly string[];
  readonly imports: readonly string[];
};

const openaiEntry = path.resolve(__dirname, 'index.ts');
const vadConfigEntry = path.resolve(
  __dirname,
  '../../realtime-vad/src/browser-vad-config.ts',
);

function consumerEntry(source: string): Plugin {
  const id = '\0default-off-consumer';
  return {
    name: 'default-off-consumer',
    resolveId(candidate) {
      return candidate === 'virtual:default-off-consumer' ? id : undefined;
    },
    load(candidate) {
      return candidate === id ? source : undefined;
    },
  };
}

function isChunk(value: unknown): value is Chunk {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'chunk' &&
    typeof (value as { fileName?: unknown }).fileName === 'string' &&
    Array.isArray((value as { imports?: unknown }).imports) &&
    typeof (value as { modules?: unknown }).modules === 'object' &&
    (value as { modules?: unknown }).modules !== null
  );
}

function chunksFromBuild(result: unknown): Chunk[] {
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((output) => {
    if (
      typeof output !== 'object' ||
      output === null ||
      !Array.isArray((output as { output?: unknown }).output)
    ) {
      return [];
    }
    return (output as { output: unknown[] }).output.filter(isChunk);
  });
}

async function bundleGraph(source: string): Promise<BundleGraph> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [consumerEntry(source)],
    resolve: {
      alias: [
        {
          find: '@maelstrom-co/realtime-openai',
          replacement: openaiEntry,
        },
        {
          find: '@maelstrom-co/realtime-vad/config',
          replacement: vadConfigEntry,
        },
      ],
    },
    build: {
      write: false,
      minify: false,
      rolldownOptions: {
        input: 'virtual:default-off-consumer',
        external: [
          /^@maelstrom-co\/(?:client|protocol|realtime(?:-protocol)?)(?:\/|$)/,
          '@maelstrom-co/realtime-vad',
        ],
      },
    },
  });
  const chunks = chunksFromBuild(result);
  const entry = chunks.find((chunk) => chunk.isEntry);
  if (!entry) throw new Error('expected a consumer entry chunk');

  const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const visited = new Set<string>();
  const modules = new Set<string>();
  const imports = new Set<string>();
  const visit = (chunk: Chunk): void => {
    if (visited.has(chunk.fileName)) return;
    visited.add(chunk.fileName);
    for (const module of Object.keys(chunk.modules)) modules.add(module);
    for (const imported of chunk.imports) {
      imports.add(imported);
      const importedChunk = byFileName.get(imported);
      if (importedChunk) visit(importedChunk);
    }
  };
  visit(entry);

  return {
    modules: [...modules].sort(),
    imports: [...imports].sort(),
  };
}

describe('OpenAIAdapter default-off bundle boundary', () => {
  test('keeps omitted and false on the same static module/import graph without VAD runtime code', async () => {
    const [omitted, explicitFalse] = await Promise.all([
      bundleGraph(`
        import { OpenAIAdapter } from '@maelstrom-co/realtime-openai';
        new OpenAIAdapter({ mintToken: async () => ({}) });
      `),
      bundleGraph(`
        import { OpenAIAdapter } from '@maelstrom-co/realtime-openai';
        new OpenAIAdapter({ mintToken: async () => ({}), greetingInterruption: false });
      `),
    ]);

    expect(omitted).toEqual(explicitFalse);
    expect(
      omitted.modules.some((id) => id.endsWith('browser-vad-config.ts')),
    ).toBe(true);
    for (const forbidden of [
      'browser-vad.ts',
      'local-audio-pre-roll.ts',
      '@ricky0123/vad-web',
      'onnxruntime-web',
      'local-audio-pre-roll-processor',
    ]) {
      expect(omitted.modules.some((id) => id.includes(forbidden))).toBe(false);
      expect(omitted.imports.some((id) => id.includes(forbidden))).toBe(false);
    }
  });
});
