import type { UIStructuralSnapshot } from '@maelstrom-co/client';
import type { TilingLayout } from '@maelstrom-co/protocol';
import { SessionId } from '@maelstrom-co/protocol';
import type {
  AdapterConnectOptions,
  RealtimeInstance,
  RealtimeProviderAdapter,
} from '@maelstrom-co/realtime';
import { RealtimeSession } from '@maelstrom-co/realtime';
import { describe, expect, it } from 'vitest';

import { TASKLANE_LAYOUT, TASKLANE_NARROW_LAYOUT } from './default-layout';

describe('Tasklane realtime grounding', () => {
  it('tells the voice provider Feedback is on the left and Tasks on the right', async () => {
    const grounding = await initialGrounding(TASKLANE_LAYOUT);
    expect(grounding).toContain('source-feedback (snapshot) on the left');
    expect(grounding).toContain('project-tasks (board) on the right');
    expect(grounding.length).toBeLessThanOrEqual(400);
  });

  it('says top and bottom for the narrow starting layout', async () => {
    const grounding = await initialGrounding(TASKLANE_NARROW_LAYOUT);
    expect(grounding).toContain('source-feedback (snapshot) at the top');
    expect(grounding).toContain('project-tasks (board) at the bottom');
    expect(grounding.length).toBeLessThanOrEqual(400);
  });
});

async function initialGrounding(layout: TilingLayout): Promise<string> {
  const snapshot: UIStructuralSnapshot = {
    instances: layout.instances,
    layout,
    layoutMode: 'tiling',
    chartDimensions: { columns: 16, rows: 9 },
  };
  let connectOptions: AdapterConnectOptions | undefined;
  const adapter: RealtimeProviderAdapter = {
    observations: { subscribe: () => () => {} },
    connect: async (options) => {
      connectOptions = options;
    },
    disconnect: async () => {},
    getAudioStreams: () => ({}),
    sendToolResult: async () => {},
    injectGrounding: () => {},
    on: () => () => {},
  };
  const instance: RealtimeInstance = {
    submitIntent: async () => ({}),
    waitForIdle: async () => {},
    getStructuralSnapshot: () => snapshot,
    getCapabilitySnapshot: () => ({ vessels: [] }),
    onSettled: () => () => {},
    addAssistantMessageAcknowledged: async () => 'inserted',
    observeEngineConnection: () => () => {},
  };
  const session = new RealtimeSession({
    adapter,
    instance,
    sessionId: SessionId('tasklane-grounding-test'),
  });
  await session.connect();
  const grounding = connectOptions?.getInitialGrounding?.() ?? '';
  await session.disconnect();
  return grounding;
}
