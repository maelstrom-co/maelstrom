import { createOpenaiChat, OPENAI_CHAT_MODELS } from '@tanstack/ai-openai';
import { afterEach, expect, it, vi } from 'vitest';
import { parsePlaygroundMetadata } from './playground-metadata';

vi.mock('@tanstack/ai-openai', { spy: true });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});

it.each([
  undefined,
  '',
  '   ',
])('keeps the catalog default when the model override is %j', async (override) => {
  vi.stubEnv('ENGINE_MODEL', override);
  vi.resetModules();
  const {
    DEFAULT_ENGINE_MODEL,
    ENGINE_MODEL,
    createDemoOpenaiChat,
    engineMetadataFrame,
  } = await import('./engine-model');
  expect(OPENAI_CHAT_MODELS).toContain(DEFAULT_ENGINE_MODEL);
  expect(DEFAULT_ENGINE_MODEL).toBe('gpt-6-luna');
  const adapter = createDemoOpenaiChat('sk-fixture-not-a-real-key');
  expect(ENGINE_MODEL).toBe(DEFAULT_ENGINE_MODEL);
  expect(adapter.model).toBe(DEFAULT_ENGINE_MODEL);
  expect(parsePlaygroundMetadata(engineMetadataFrame())?.engineModel).toBe(
    adapter.model,
  );
});

it('reports the same trimmed override used to construct the adapter', async () => {
  vi.stubEnv('ENGINE_MODEL', ' gpt-4o ');
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

it('passes each caller key to the native factory instead of using the server environment key', async () => {
  vi.stubEnv('ENGINE_MODEL', undefined);
  vi.stubEnv('OPENAI_API_KEY', 'sk-environment-fixture');
  vi.resetModules();
  const factory = vi.mocked(createOpenaiChat);
  const { createDemoOpenaiChat, ENGINE_MODEL, engineMetadataFrame } =
    await import('./engine-model');
  createDemoOpenaiChat('sk-first-caller-fixture');
  createDemoOpenaiChat('sk-second-caller-fixture');
  expect(factory.mock.calls).toEqual([
    [ENGINE_MODEL, 'sk-first-caller-fixture'],
    [ENGINE_MODEL, 'sk-second-caller-fixture'],
  ]);
  expect(engineMetadataFrame()).not.toContain('sk-');
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
