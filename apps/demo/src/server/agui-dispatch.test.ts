import { workspaceRun } from '@maelstrom-co/agui/contract';
import { AguiWorkspaceSession } from '@maelstrom-co/agui/server';
import { ChartRequestMessage, SessionId } from '@maelstrom-co/protocol';
import { expect, it, vi } from 'vitest';
import { dispatchFrame } from './dispatch';

it('keeps the BYOK gate before inference, including rehello after idle', async () => {
  const getEngine = vi.fn(() => null);
  const send = vi.fn();
  const raw = JSON.stringify({
    type: 'demo.agui.run',
    input: workspaceRun('session', {
      kind: 'plan',
      sequence: 1,
      revision: 0,
      message: ChartRequestMessage({
        sessionId: SessionId('session'),
        request: {
          type: 'chart_request',
          context: {
            layoutMode: 'tiling',
            chartDimensions: { rows: 8, columns: 12 },
            updateReasons: [
              { type: 'user_intent', intent: 'Arrange the workspace' },
            ],
          },
          vessels: [],
          instances: [],
          layout: { type: 'tiling', tree: [], instances: [] },
        },
      }),
    }),
  });
  const context = {
    getEngine,
    helloReceived: false,
    wasHelloed: false,
    engineUnavailableReason: 'No key',
    workspace: {
      active: () => false,
      session: () => new AguiWorkspaceSession('session'),
      send,
    },
  };
  expect(await dispatchFrame(raw, context)).toEqual({ kind: 'none' });
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'RUN_ERROR' }),
  );
  send.mockClear();
  expect(await dispatchFrame(raw, { ...context, wasHelloed: true })).toEqual({
    kind: 'rehello',
  });
  expect(send).not.toHaveBeenCalled();
  expect(getEngine).not.toHaveBeenCalled();
});
