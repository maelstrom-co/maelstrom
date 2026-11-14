import { expect, test } from 'bun:test';

import {
  copyPreviewState,
  type PreviewCopyManifest,
  type PreviewScope,
  type PreviewStateDestination,
  type PreviewStateKey,
  type PreviewStateReader,
  snapshotPreviewState,
  type WireValue,
} from './preview-state-copy.ts';

const stack = 'MaelstromDemoPreview';
const scope = { stack, stage: 'pr-42' };
const key = (value: PreviewStateKey) =>
  JSON.stringify([value.stack, value.stage, value.fqn]);
const outputKey = (value: PreviewScope) =>
  JSON.stringify([value.stack, value.stage]);
const row = (fqn = 'Website'): WireValue => ({
  fqn,
  logicalId: 'Website',
  resourceType: 'Cloudflare.Worker',
  status: 'created',
  instanceId: 'recorded-instance',
  attr: { workerName: 'maelstrom-playground-alchemy-pr-42' },
  props: { value: { __redacted__: 'sensitive-fixture' } },
  unknownFutureField: { keep: true },
});
const manifest: PreviewCopyManifest = {
  pullNumbers: ['42', '43'],
  workerNames: ['maelstrom-playground-alchemy-pr-42'],
};

function fixture() {
  const original = new Map<string, WireValue>([
    [key({ ...scope, fqn: 'Website' }), row()],
    [
      key({ stack: 'MaelstromCloudFoundation', stage: 'dev', fqn: 'Private' }),
      { secret: 'cloud-fixture' },
    ],
  ]);
  const originalOutputs = new Map<string, WireValue>([
    [outputKey(scope), { url: 'https://preview.invalid' }],
  ]);
  const copied = new Map<string, WireValue>();
  const copiedOutputs = new Map<string, WireValue>();
  const reads: PreviewStateKey[] = [];
  const writes: PreviewStateKey[] = [];
  let initialized = false;
  let sourceVersion = 7;
  const reader = (
    rows: Map<string, WireValue>,
    outputs: Map<string, WireValue>,
  ): PreviewStateReader => ({
    version: async () => (rows === original ? sourceVersion : 8),
    stacks: async () => [
      ...new Set(
        [...rows.keys(), ...outputs.keys()].map(
          (id) => JSON.parse(id)[0] as string,
        ),
      ),
    ],
    stages: async (name) => [
      ...new Set(
        [...rows.keys()]
          .map((id) => JSON.parse(id) as string[])
          .filter((parts) => parts[0] === name)
          .map((parts) => parts[1]!),
      ),
    ],
    keys: async (selected) =>
      [...rows.keys()]
        .map((id) => JSON.parse(id) as string[])
        .filter(
          (parts) => parts[0] === selected.stack && parts[1] === selected.stage,
        )
        .map((parts) => parts[2]!),
    get: async (selected) => {
      if (rows === original) reads.push(selected);
      return rows.get(key(selected));
    },
    output: async (selected) => outputs.get(outputKey(selected)),
  });
  const source = reader(original, originalOutputs);
  const destination: PreviewStateDestination = {
    ...reader(copied, copiedOutputs),
    exists: async () => initialized,
    initialize: async () => {
      initialized = true;
    },
    put: async (selected, value) => {
      writes.push(selected);
      copied.set(key(selected), structuredClone(value));
    },
    putOutput: async (selected, value) => {
      copiedOutputs.set(outputKey(selected), structuredClone(value));
    },
  };
  return {
    source,
    destination,
    original,
    originalOutputs,
    copied,
    copiedOutputs,
    reads,
    writes,
    initialized: () => initialized,
    setSourceVersion: (value: number) => {
      sourceVersion = value;
    },
  };
}

test('a move preserves recorded identities and outputs while leaving Cloud state unread and unchanged', async () => {
  const f = fixture();
  const before = structuredClone(f.original);
  const proof = await copyPreviewState(
    f.source,
    f.destination,
    manifest,
    async () => {},
  );
  expect(proof).toMatchObject({
    resources: 1,
    outputs: 1,
    sourceUnchanged: true,
    manifestVerified: true,
    destinationWasAbsent: true,
  });
  expect(f.copied.get(key({ ...scope, fqn: 'Website' }))).toEqual(row());
  expect(f.copiedOutputs.get(outputKey(scope))).toEqual(
    f.originalOutputs.get(outputKey(scope)),
  );
  expect(f.original).toEqual(before);
  expect(
    f.reads.every((read) => read.stack !== 'MaelstromCloudFoundation'),
  ).toBeTrue();
  expect(
    [...f.copied.keys()].some((id) => id.includes('MaelstromCloudFoundation')),
  ).toBeFalse();
});

test('all replacement history, action replay data and namespaced FQNs survive without projection', async () => {
  const f = fixture();
  const replacement: WireValue = {
    ...(row('CloudFeature/Website') as object),
    status: 'replaced',
    old: {
      ...(row() as object),
      instanceId: 'older',
      old: { ...(row() as object), instanceId: 'oldest' },
    },
  };
  const action: WireValue = {
    kind: 'action',
    status: 'complete',
    inputHash: 'original-hash',
    input: { secret: { __redacted__: 'private' } },
    output: { outcome: 'kept' },
  };
  f.original.set(key({ ...scope, fqn: 'CloudFeature/Website' }), replacement);
  f.original.set(key({ ...scope, fqn: 'Action' }), action);
  await copyPreviewState(f.source, f.destination, manifest, async () => {});
  expect(f.copied.get(key({ ...scope, fqn: 'CloudFeature/Website' }))).toEqual(
    replacement,
  );
  expect(f.copied.get(key({ ...scope, fqn: 'Action' }))).toEqual(action);
});

test('the explicit PR manifest carries output-only stages and persisted null outputs', async () => {
  const f = fixture();
  f.originalOutputs.set(outputKey({ stack, stage: 'pr-43' }), null);
  expect(await f.source.stages(stack)).not.toContain('pr-43');
  await copyPreviewState(f.source, f.destination, manifest, async () => {});
  expect(f.copiedOutputs.has(outputKey({ stack, stage: 'pr-43' }))).toBeTrue();
  expect(f.copiedOutputs.get(outputKey({ stack, stage: 'pr-43' }))).toBeNull();
});

test('additional manual stages retain output-only data beyond repository PR history', async () => {
  const f = fixture();
  f.originalOutputs.set(outputKey({ stack, stage: 'pr-9999' }), {
    retained: true,
  });
  await copyPreviewState(
    f.source,
    f.destination,
    { ...manifest, additionalStages: ['pr-9999'] },
    async () => {},
  );
  expect(f.copiedOutputs.get(outputKey({ stack, stage: 'pr-9999' }))).toEqual({
    retained: true,
  });
});

test('legacy Wrangler Workers do not masquerade as missing Alchemy ownership', async () => {
  const f = fixture();
  const proof = await copyPreviewState(
    f.source,
    f.destination,
    {
      ...manifest,
      workerNames: [...manifest.workerNames, 'maelstrom-www-pr-50'],
    },
    async () => {},
  );
  expect(proof.legacyWorkers).toBe(1);
});

test('a live current Worker without its source identity blocks destination creation', async () => {
  const f = fixture();
  f.original.delete(key({ ...scope, fqn: 'Website' }));
  await expect(
    copyPreviewState(f.source, f.destination, manifest, async () => {}),
  ).rejects.toThrow('PREVIEW_LIVE_WORKER_STATE_MISSING');
  expect(f.initialized()).toBeFalse();
});

test('a preexisting target is never overwritten, including an abandoned partial copy', async () => {
  const f = fixture();
  await f.destination.initialize([]);
  f.copied.set(key({ ...scope, fqn: 'Foreign' }), { retained: true });
  await expect(
    copyPreviewState(f.source, f.destination, manifest, async () => {}),
  ).rejects.toThrow('PREVIEW_DESTINATION_ALREADY_EXISTS');
  expect(f.writes).toEqual([]);
  expect(f.copied.size).toBe(1);
});

test('an incorrect source protocol fails before any target mutation', async () => {
  const f = fixture();
  f.setSourceVersion(8);
  await expect(
    copyPreviewState(f.source, f.destination, manifest, async () => {}),
  ).rejects.toThrow('PREVIEW_SOURCE_PROTOCOL_REJECTED');
  expect(f.initialized()).toBeFalse();
});

test('missing listed state is not interpreted as an empty source', async () => {
  const f = fixture();
  f.source.get = async () => undefined;
  await expect(
    copyPreviewState(f.source, f.destination, manifest, async () => {}),
  ).rejects.toThrow('PREVIEW_LISTED_ROW_MISSING');
  expect(f.initialized()).toBeFalse();
});

test('a lost write cannot be certified from the setter return value', async () => {
  const f = fixture();
  f.destination.put = async () => {};
  await expect(
    copyPreviewState(f.source, f.destination, manifest, async () => {}),
  ).rejects.toThrow('PREVIEW_COPY_VERIFICATION_FAILED');
});

test('an outside source change during the copy prevents a successful receipt', async () => {
  const f = fixture();
  const put = f.destination.put;
  f.destination.put = async (selected, value) => {
    await put(selected, value);
    f.original.set(key({ ...scope, fqn: 'Website' }), {
      ...(row() as object),
      instanceId: 'changed-during-copy',
    });
  };
  await expect(
    copyPreviewState(f.source, f.destination, manifest, async () => {}),
  ).rejects.toThrow('PREVIEW_SOURCE_CHANGED');
});

test('foreign destination namespaces cannot be hidden behind matching selected rows', async () => {
  const f = fixture();
  const put = f.destination.put;
  f.destination.put = async (selected, value) => {
    await put(selected, value);
    f.copied.set(key({ stack: 'OtherProject', stage: 'prod', fqn: 'Keep' }), {
      keep: true,
    });
  };
  await expect(
    copyPreviewState(f.source, f.destination, manifest, async () => {}),
  ).rejects.toThrow('PREVIEW_DESTINATION_FOREIGN_STATE');
});

test('caller pause or candidate revocation stops writes and never changes source state', async () => {
  const f = fixture();
  const before = structuredClone(f.original);
  let checks = 0;
  await expect(
    copyPreviewState(f.source, f.destination, manifest, async () => {
      if (++checks === 3) throw new Error('caller pause revoked');
    }),
  ).rejects.toThrow('caller pause revoked');
  expect(f.writes).toEqual([]);
  expect(f.original).toEqual(before);
});

test('byte-marker collisions are rejected even inside secrets and unrecognized legacy envelopes', async () => {
  const values: WireValue[] = [
    { literal: { __bytes__: 'YQ==' } },
    { secret: { __redacted__: { __bytes__: 'YQ==' } } },
    { date: { __date__: { __bytes__: 'YQ==' } } },
  ];
  for (const value of values) {
    const f = fixture();
    f.original.set(key({ ...scope, fqn: 'Bytes' }), value);
    await expect(
      copyPreviewState(f.source, f.destination, manifest, async () => {}),
    ).rejects.toThrow('PREVIEW_NEW_MARKER_COLLISION');
    expect(f.initialized()).toBeFalse();
  }
  const f = fixture();
  const literal = { __bytes__: 'YQ==', label: 'ordinary object' };
  f.original.set(key({ ...scope, fqn: 'Bytes' }), literal);
  await copyPreviewState(f.source, f.destination, manifest, async () => {});
  expect(f.copied.get(key({ ...scope, fqn: 'Bytes' }))).toEqual(literal);
});

test('noncanonical or duplicate stage inventories cannot be silently truncated or skipped', async () => {
  const f = fixture();
  f.source.stages = async () => ['prod'];
  await expect(snapshotPreviewState(f.source, manifest)).rejects.toThrow(
    'PREVIEW_STAGE_MANIFEST_REJECTED',
  );
  f.source.stages = async () => ['pr-42', 'pr-42'];
  await expect(snapshotPreviewState(f.source, manifest)).rejects.toThrow(
    'PREVIEW_INVENTORY_INCOMPLETE',
  );
});

test('aggregate bounds stop collection before the next stage can exhaust memory', async () => {
  let reads = 0;
  const source: PreviewStateReader = {
    version: async () => 7,
    stacks: async () => [stack],
    stages: async (name) => (name === stack ? ['pr-1', 'pr-2'] : []),
    keys: async () => Array.from({ length: 600 }, (_, i) => String(i)),
    get: async () => {
      reads++;
      return { attr: { workerName: 'fixture' } };
    },
    output: async () => undefined,
  };
  await expect(
    snapshotPreviewState(source, { pullNumbers: [], workerNames: [] }),
  ).rejects.toThrow('PREVIEW_SNAPSHOT_LIMIT');
  expect(reads).toBe(600);
});
test('the byte budget stops collection before additional rows or destination creation', async () => {
  let reads = 0;
  const source: PreviewStateReader = {
    version: async () => 7,
    stacks: async () => [stack],
    stages: async (name) => (name === stack ? ['pr-1'] : []),
    keys: async () => ['one', 'two', 'three'],
    get: async () => {
      reads++;
      return { payload: 'x'.repeat(9 * 1024 * 1024) };
    },
    output: async () => undefined,
  };
  await expect(
    snapshotPreviewState(source, { pullNumbers: [], workerNames: [] }),
  ).rejects.toThrow('PREVIEW_SNAPSHOT_LIMIT');
  expect(reads).toBe(2);
});
