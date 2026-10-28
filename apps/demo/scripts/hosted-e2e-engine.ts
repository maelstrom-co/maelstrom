import { createEngine, type Engine } from '@maelstrom-co/engine';
import { ok } from '@maelstrom-co/protocol';

/** Local-only engine for UI smoke tests; never accepts a real provider credential. */
export function buildHostedE2EEngine(apiKey: string): {
  readonly engine: Engine | null;
  readonly initError: string | null;
} {
  if (!apiKey.startsWith('sk-test-') || !apiKey.includes('-not-a-real-key-'))
    return { engine: null, initError: 'E2E requires a synthetic key.' };
  return {
    initError: null,
    engine: createEngine({
      planner: async ({ request }) =>
        ok({
          userMessage: 'Local E2E workspace ready.',
          rationale: 'Preserve the seeded workspace.',
          executionPlan: [],
          layout: {
            tree: request.layout.type === 'tiling' ? request.layout.tree : [],
            instances: request.instances,
          },
        }),
    }),
  };
}

/** Denies every outbound fetch in the stand-in, including future provider transports. */
export const denyHostedE2ENetwork: typeof fetch = Object.assign(
  async () => {
    throw new Error('External network is disabled in the hosted E2E server.');
  },
  { preconnect() {} },
);
