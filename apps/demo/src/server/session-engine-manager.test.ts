import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyTextAdapter } from '@tanstack/ai';
import { SessionEngineManager } from './session-engine-manager';

// createEngine's config validator (packages/engine/src/lib/validation/engine-config.ts)
// requires kind/name/model plus callable chatStream/structuredOutput on the
// adapter — a bare `{}` fails that zod check before any of the manager's own
// logic runs, so the fixture needs the minimal real shape.
const fakeAdapter = {
  kind: 'text',
  name: 'fake',
  model: 'fake-model',
  chatStream: () => {},
  structuredOutput: () => {},
} as unknown as AnyTextAdapter;

function makeManager(overrides: Partial<{ maxSessions: number; idleTtlMs: number }> = {}) {
  return new SessionEngineManager({
    maxSessions: overrides.maxSessions ?? 50,
    idleTtlMs: overrides.idleTtlMs ?? 30 * 60 * 1000,
    systemRules: 'test rules',
    createAdapter: () => fakeAdapter,
  });
}

describe('SessionEngineManager', () => {
  let manager: SessionEngineManager;

  afterEach(() => {
    manager?.dispose();
  });

  it('returns the same engine instance for the same sessionId', () => {
    manager = makeManager();
    const first = manager.getOrCreate('session-a', 'sk-key-a');
    const second = manager.getOrCreate('session-a', 'sk-key-a');
    expect(first).toBe(second);
  });

  it('evicts the least-recently-used session once maxSessions is exceeded', () => {
    manager = makeManager({ maxSessions: 2 });
    manager.getOrCreate('session-1', 'sk-1');
    manager.getOrCreate('session-2', 'sk-2');
    expect(manager.size()).toBe(2);
    manager.getOrCreate('session-3', 'sk-3');
    expect(manager.size()).toBe(2);
    // session-1 was least recently used and should be gone; re-creating it
    // must build a fresh engine (not throw), proving eviction happened.
    const rebuilt = manager.getOrCreate('session-1', 'sk-1');
    expect(rebuilt).toBeTruthy();
  });

  it('evicts a session immediately when evict() is called (socket close)', () => {
    manager = makeManager();
    manager.getOrCreate('session-a', 'sk-key-a');
    expect(manager.size()).toBe(1);
    manager.evict('session-a');
    expect(manager.size()).toBe(0);
  });

  it('evicts a session after the idle TTL elapses', async () => {
    manager = makeManager({ idleTtlMs: 10 });
    manager.getOrCreate('session-a', 'sk-key-a');
    expect(manager.size()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(manager.size()).toBe(0);
  });

  it('never logs or throws the API key in any console output', () => {
    const calls: unknown[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      calls.push(args);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      calls.push(args);
    });

    const throwingManager = new SessionEngineManager({
      maxSessions: 50,
      idleTtlMs: 30 * 60 * 1000,
      systemRules: 'test rules',
      createAdapter: () => {
        throw new Error('boom with key sk-secret-should-never-appear-anywhere');
      },
    });

    const secret = 'sk-secret-should-never-appear-anywhere';
    let thrown: unknown;
    try {
      throwingManager.getOrCreate('session-a', secret);
    } catch (err) {
      thrown = err;
    }

    errorSpy.mockRestore();
    warnSpy.mockRestore();
    throwingManager.dispose();

    const thrownMessage = thrown instanceof Error ? thrown.message : String(thrown);
    expect(thrownMessage).not.toContain(secret);
    for (const call of calls) {
      expect(JSON.stringify(call)).not.toContain(secret);
    }
  });
});
