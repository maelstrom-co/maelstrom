import { describe, expect, it, vi } from 'vitest';

import {
  createOutlineStore,
  createPreparationOwner,
  OUTLINE_STORAGE_KEY,
} from './outline.store';

describe('preparation outline ownership and restore', () => {
  it('rejects a retired Action and deferred persistence callback after a replacement reuses the outline', async () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const store = createOutlineStore(() => storage);
    const oldOwner = createPreparationOwner();
    const old = store.forOwner(oldOwner);
    old.create('Opening');
    const topic = store.getSnapshot().topics[0]!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lateAction = gate.then(() => old.edit(topic.id, 'Stale response'));
    const deferredPersistence = old.persist;
    oldOwner.retire();
    const replacement = store.forOwner(createPreparationOwner());
    replacement.edit(topic.id, 'Current opening');
    const durable = storage.setItem.mock.calls.at(-1);
    release();
    await expect(lateAction).rejects.toThrow('retired');
    expect(() => deferredPersistence()).toThrow('retired');
    expect(store.getSnapshot().topics).toEqual([
      { id: topic.id, content: 'Current opening' },
    ]);
    expect(storage.setItem.mock.calls.at(-1)).toEqual(durable);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(storage.setItem.mock.calls[1]?.[0]).toBe(OUTLINE_STORAGE_KEY);
  });

  it('rechecks ownership at persistence after a subscriber retires the writer', () => {
    const storage = { getItem: () => null, setItem: vi.fn() };
    const store = createOutlineStore(() => storage);
    const owner = createPreparationOwner();
    store.subscribe(owner.retire);
    expect(() => store.forOwner(owner).create('Opening')).toThrow('retired');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    'not JSON',
    JSON.stringify({ version: 2, topics: [] }),
    JSON.stringify({
      version: 1,
      topics: [{ id: 'invalid', content: 'Opening' }],
    }),
    JSON.stringify({
      version: 1,
      topics: [{ id: `tp-${'-'.repeat(36)}`, content: 'Opening' }],
    }),
    JSON.stringify({
      version: 1,
      topics: [{ id: 'tp-00000000-0000-4000-8000-000000000001', content: ' ' }],
    }),
    JSON.stringify({
      version: 1,
      topics: [
        { id: 'tp-00000000-0000-4000-8000-000000000001', content: 'One' },
        { id: 'tp-00000000-0000-4000-8000-000000000001', content: 'Two' },
      ],
    }),
  ])('ignores an invalid persisted outline: %s', (raw) => {
    expect(
      createOutlineStore(() => ({
        getItem: () => raw,
        setItem: vi.fn(),
      })).getSnapshot().topics,
    ).toEqual([]);
  });

  it('keeps duplicate content identities separate and persists only the validated durable fields', () => {
    let raw: string | null = null;
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    };
    const store = createOutlineStore(() => storage);
    const writer = store.forOwner(createPreparationOwner());
    writer.create('Same');
    writer.create('Same');
    const [first, second] = store.getSnapshot().topics;
    expect(first!.id).not.toBe(second!.id);
    writer.move(second!.id, 1);
    writer.edit(first!.id, 'Edited');
    writer.setSpoken(second!.id, true);
    const restored = createOutlineStore(() => storage).getSnapshot();
    expect(restored.topics).toEqual([
      second,
      { id: first!.id, content: 'Edited' },
    ]);
    expect(restored.spoken.size).toBe(0);
    expect(Object.keys(JSON.parse(raw!))).toEqual(['version', 'topics']);
    writer.remove(first!.id);
    writer.create('New');
    expect(store.getSnapshot().topics[1]!.id).not.toBe(first!.id);
  });

  it('remains usable when browser storage is unavailable', () => {
    const store = createOutlineStore(() => {
      throw new Error('Storage denied');
    });
    store.forOwner(createPreparationOwner()).create('In memory');
    expect(store.getSnapshot().topics[0]?.content).toBe('In memory');
  });
});
