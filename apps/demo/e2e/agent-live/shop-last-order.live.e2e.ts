import { expect, test } from '@playwright/test';

import { SEED_ORDERS } from '../../src/shop/stores/fixtures';
import {
  collectWebSocketFrames,
  receivedAgentEvents,
  sentAgentInputs,
} from './agent-frames';

const UTTERANCE = 'show my last order';
const LAST_ORDER_ID = 'ORD-10455';

test.skip(
  !process.env.OPENAI_API_KEY,
  'OPENAI_API_KEY is not set. The live agent check needs a real model key in the repo-root .env.',
);

test('typed "show my last order" runs the demo agent and opens the order', async ({
  page,
}) => {
  const lastOrder = SEED_ORDERS.find((order) => order.id === LAST_ORDER_ID);
  if (!lastOrder)
    throw new Error(`Seed orders no longer include ${LAST_ORDER_ID}`);

  const frames = collectWebSocketFrames(page);
  await page.goto('/shop');

  await expect(
    page.getByRole('status', { name: 'Connection status: connected' }),
  ).toBeVisible();
  await page.getByLabel('Ask the pet shop').fill(UTTERANCE);
  await page.getByRole('button', { name: 'Send' }).click();

  await expect
    .poll(
      () =>
        sentAgentInputs(frames).some(
          (input) => input.type === 'utterance' && input.text === UTTERANCE,
        ),
      { message: 'the page sends the utterance as client.agent.input' },
    )
    .toBe(true);

  await expect
    .poll(
      () =>
        receivedAgentEvents(frames).find(
          (event) => event.type === 'accepted' && event.disposition === 'agent',
        ),
      { message: 'the engine accepts the utterance on the agent route' },
    )
    .toBeDefined();
  const runId = receivedAgentEvents(frames).find(
    (event) => event.type === 'accepted' && event.disposition === 'agent',
  )?.runId;
  expect(typeof runId).toBe('string');

  await expect
    .poll(
      () =>
        receivedAgentEvents(frames).some(
          (event) =>
            event.type === 'tool_call' && event.name === 'latest_order',
        ),
      { message: 'the agent calls the latest_order tool' },
    )
    .toBe(true);

  await expect
    .poll(
      () =>
        receivedAgentEvents(frames).find(
          (event) => event.type === 'ui_change' && event.runId === runId,
        ),
      { message: 'the agent run sends a ui_change' },
    )
    .toBeDefined();
  const changeId = receivedAgentEvents(frames).find(
    (event) => event.type === 'ui_change' && event.runId === runId,
  )?.changeId;
  expect(typeof changeId).toBe('string');

  const orderDetail = page
    .locator('.vessel-card')
    .filter({ has: page.getByRole('button', { name: 'All orders' }) });
  await expect(orderDetail).toContainText(lastOrder.id);
  await expect(orderDetail).toContainText(`Placed ${lastOrder.placedOn}`);
  for (const item of lastOrder.items) {
    await expect(
      orderDetail.getByText(item.name, { exact: true }),
    ).toBeVisible();
  }

  await expect
    .poll(
      () =>
        sentAgentInputs(frames).some(
          (input) => input.type === 'ui_applied' && input.changeId === changeId,
        ),
      { message: 'the page acknowledges the ui_change with ui_applied' },
    )
    .toBe(true);
});
