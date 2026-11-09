import type { ServerToolContext } from '@maelstrom-co/engine';
import { describe, expect, it } from 'vitest';

import { latestOrderTool } from './latest-order-tool';

const EXPECTED_SUMMARY =
  'Order ORD-10455 placed 2026-09-14: 1x Summit Trail Adult Chicken & Brown Rice, 1x Whisker & Co Indoor Adult Chicken';

describe('latestOrderTool', () => {
  it('returns the newest seed order and its output passes the output schema', async () => {
    const output = await latestOrderTool.execute({}, contextFor());

    expect(output.orderId).toBe('ORD-10455');
    expect(output.placedOn).toBe('2026-09-14');
    expect(latestOrderTool.output.safeParse(output).success).toBe(true);
  });

  it('summarizes the order id, items and date in one line of at most 200 characters', async () => {
    const output = await latestOrderTool.execute({}, contextFor());

    const summary = latestOrderTool.summarize(output);

    expect(summary).toBe(EXPECTED_SUMMARY);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary).not.toMatch(/\n/);
  });

  it('keeps the caller token and user out of the output and summary', async () => {
    const tokenSentinel = 'sentinel-token-7f3a9c';
    const userSentinel = 'sentinel-user-b41e02';

    const output = await latestOrderTool.execute(
      {},
      contextFor({
        token: tokenSentinel,
        user: { id: userSentinel, name: userSentinel },
      }),
    );
    const serializedOutput = JSON.stringify(output);
    const summary = latestOrderTool.summarize(output);

    for (const sentinel of [tokenSentinel, userSentinel]) {
      expect(serializedOutput).not.toContain(sentinel);
      expect(summary).not.toContain(sentinel);
    }
  });
});

function contextFor(
  overrides: Partial<Pick<ServerToolContext, 'token' | 'user'>> = {},
): ServerToolContext {
  return {
    user: undefined,
    signal: new AbortController().signal,
    ...overrides,
  };
}
