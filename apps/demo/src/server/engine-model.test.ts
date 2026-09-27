import { afterEach, expect, it, vi } from 'vitest';
import { parsePlaygroundMetadata } from './playground-metadata';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('reports the same configured override used to construct the adapter', async () => {
  vi.stubEnv('ENGINE_MODEL', 'gpt-4o');
  vi.resetModules();
  const { createDemoOpenaiChat, engineMetadataFrame } = await import(
    './engine-model'
  );
  const adapter = createDemoOpenaiChat('sk-fixture-not-a-real-key');
  expect(parsePlaygroundMetadata(engineMetadataFrame())).toEqual({
    type: 'playground.metadata',
    engineModel: adapter.model,
    source: 'server-configuration',
  });
  expect(adapter.model).toBe('gpt-4o');
  expect(engineMetadataFrame()).not.toContain('sk-fixture');
});

it('projects only bounded, valid server model metadata', () => {
  const base = {
    type: 'playground.metadata',
    source: 'server-configuration',
    engineModel: 'gpt-6-luna',
  };
  expect(
    parsePlaygroundMetadata(JSON.stringify({ ...base, extra: 'unrelated' })),
  ).toEqual(base);
  for (const engineModel of ['', 'x'.repeat(129), null, 'a\nb'])
    expect(
      parsePlaygroundMetadata(JSON.stringify({ ...base, engineModel })),
    ).toBeUndefined();
  expect(parsePlaygroundMetadata('{')).toBeUndefined();
  expect(
    parsePlaygroundMetadata(JSON.stringify({ ...base, source: 'guessed' })),
  ).toBeUndefined();
});
