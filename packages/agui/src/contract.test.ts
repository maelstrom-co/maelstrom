import { expect, it } from 'bun:test';

import {
  actionDigest,
  MAX_WORKSPACE_FRAME_BYTES,
  readWorkspaceRun,
  WORKSPACE_RUN,
  workspaceRun,
} from '@maelstrom-co/agui-protocol';

it('rejects a multibyte ingress frame above the encoded byte budget', () => {
  const input = workspaceRun('session', {
    kind: 'applied',
    sequence: 1,
    application: {
      correlation: {
        threadId: 'session',
        runId: 'plan',
        requestId: 'request',
        callId: 'call',
        revision: 0,
      },
      status: 'applied',
      actions: [
        { instanceId: '界'.repeat(400_000), action: 'write', succeeded: true },
      ],
      chart: {
        instances: [],
        layout: null,
        layoutMode: 'tiling',
        chartDimensions: { columns: 12, rows: 8 },
      },
    },
  });
  const wire = JSON.stringify({ type: WORKSPACE_RUN, input });
  expect(wire.length).toBeLessThan(MAX_WORKSPACE_FRAME_BYTES);
  expect(new TextEncoder().encode(wire).byteLength).toBeGreaterThan(
    MAX_WORKSPACE_FRAME_BYTES,
  );
  expect(readWorkspaceRun(wire) === undefined).toBe(true);
});

it('preserves exact Unicode identity and multiplicity when action execution changes order', async () => {
  const a = { instanceId: 'é', action: 'increment' };
  const b = { instanceId: 'e\u0301', action: 'increment' };
  expect(await actionDigest([a, b, a])).toBe(await actionDigest([a, a, b]));
  expect(await actionDigest([a, b, a])).not.toBe(await actionDigest([a, b]));
  expect(await actionDigest([a])).not.toBe(await actionDigest([b]));
});
