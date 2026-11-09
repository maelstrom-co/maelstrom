import { expect, test } from 'bun:test';

import { z } from 'zod';

import { serverTool, type ServerTool } from './server-tool.js';
import { createToolRegistry } from './tool-registry.js';

const echoTool = serverTool({
  name: 'echo',
  description: 'Echo the text',
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string() }),
  execute: async (input) => input,
  summarize: (output) => output.text,
});

test('a tool without sideEffect or approval registers as non_idempotent and never', () => {
  const entry = createToolRegistry([echoTool]).get('echo');
  expect(entry?.locus).toBe('server');
  expect(entry?.sideEffect).toBe('non_idempotent');
  expect(entry?.approval).toBe('never');
  expect(entry?.summarize({ text: 'hi' })).toBe('hi');
  expect(entry?.tool).toBe(echoTool);
});

test('declared sideEffect is kept', () => {
  const readOnly = serverTool({
    ...echoTool,
    name: 'peek',
    sideEffect: 'read_only',
  });
  expect(createToolRegistry([readOnly]).get('peek')?.sideEffect).toBe(
    'read_only',
  );
});

test('lookup of an unknown name is undefined and entries keep registration order', () => {
  const other = serverTool({ ...echoTool, name: 'other' });
  const registry = createToolRegistry([echoTool, other]);
  expect(registry.get('missing')).toBeUndefined();
  expect(registry.entries().map((entry) => entry.tool.name)).toEqual([
    'echo',
    'other',
  ]);
});

test('duplicate names are rejected', () => {
  expect(() => createToolRegistry([echoTool, echoTool])).toThrow(
    'Duplicate server tool name "echo"',
  );
});

test.each(['', 'has space', 'dot.name', 'a'.repeat(65)])(
  'invalid name %p is rejected',
  (name) => {
    expect(() => createToolRegistry([{ ...echoTool, name }])).toThrow(
      /Invalid server tool name .* must match/,
    );
  },
);

test('a name of 64 allowed characters is accepted', () => {
  const name = `${'a'.repeat(62)}_-`;
  expect(createToolRegistry([{ ...echoTool, name }]).get(name)).toBeDefined();
});

test('an untyped caller without summarize is rejected', () => {
  const untyped = {
    ...echoTool,
    summarize: undefined,
  } as unknown as ServerTool<{ text: string }, { text: string }>;
  expect(() => createToolRegistry([untyped])).toThrow(
    'Server tool "echo" must define summarize',
  );
});

test('serverTool without summarize fails typecheck', () => {
  const declare = () =>
    // @ts-expect-error summarize is required
    serverTool({
      name: 'nosummary',
      description: 'x',
      input: z.object({}),
      output: z.object({}),
      execute: async () => ({}),
    });
  expect(typeof declare).toBe('function');
});
