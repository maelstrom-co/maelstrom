import { ChartRequestMessage, isOk, SessionId } from '@maelstrom-co/protocol';
import { afterEach, expect, it, vi } from 'vitest';
import {
  buildHostedE2EEngine,
  denyHostedE2ENetwork,
} from '../../scripts/hosted-e2e-engine';

afterEach(() => vi.unstubAllGlobals());

it('handles a fake BYOK chart request locally without attempting a provider call', async () => {
  const network = vi.fn(denyHostedE2ENetwork);
  vi.stubGlobal('fetch', network);
  const built = buildHostedE2EEngine('sk-test-ui-not-a-real-key-1234567890');
  if (!built.engine) throw new Error('Missing local engine');
  const result = await built.engine.handle(
    ChartRequestMessage({
      sessionId: SessionId('e2e'),
      request: {
        type: 'chart_request',
        context: {
          chartDimensions: { rows: 12, columns: 12 },
          layoutMode: 'tiling',
          updateReasons: [
            { type: 'user_intent', intent: 'Keep the workspace' },
          ],
        },
        vessels: [],
        instances: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      },
    }),
  );
  expect(isOk(result)).toBe(true);
  if (!isOk(result)) throw new Error('Local E2E request failed');
  expect(result.value).toMatchObject({
    type: 'chart_response',
    response: { userMessage: 'Local E2E workspace ready.' },
  });
  expect(network).not.toHaveBeenCalled();
});

it('rejects real-looking credentials and blocks outbound fetches without a fallback', async () => {
  expect(
    buildHostedE2EEngine('sk-live-key-must-not-be-used').engine,
  ).toBeNull();
  await expect(
    denyHostedE2ENetwork('https://api.openai.com/v1/chat/completions'),
  ).rejects.toThrow('External network is disabled');
});
