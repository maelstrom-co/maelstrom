import type {
  AgentAcceptedEvent,
  AgentFinishedEvent,
  AgentUiAppliedInput,
  AgentUiChangeEvent,
  AgentUtteranceInput,
  ChangeId,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';
import { expect, test } from '@playwright/test';

import { SEED_ORDERS } from '../../src/shop/stores/fixtures';
import {
  type CollectedFrame,
  collectWebSocketFrames,
  receivedAgentEvents,
  sentAgentInputs,
} from './agent-frames';

const UTTERANCE = 'show my last order';
const LAST_ORDER_ID = 'ORD-10455';

test.skip(
  !process.env.OPENAI_API_KEY?.trim(),
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
    .poll(() => sentUtterance(frames) !== undefined, {
      message: 'the page sends the utterance as client.agent.input',
    })
    .toBe(true);
  const { inputId } = found(sentUtterance(frames), 'utterance input');

  await expect
    .poll(() => acceptedFor(frames, inputId), {
      message: 'the engine accepts the utterance',
    })
    .toBeDefined();
  const accepted = found(acceptedFor(frames, inputId), 'accepted event');
  expect(accepted.disposition).toBe('agent');
  const { runId } = accepted;

  await expect
    .poll(
      () =>
        receivedAgentEvents(frames).some(
          (event) =>
            event.type === 'tool_call' &&
            event.runId === runId &&
            event.name === 'latest_order',
        ),
      { message: 'the agent calls the latest_order tool' },
    )
    .toBe(true);

  await expect
    .poll(() => uiChangeFor(frames, runId), {
      message: 'the agent run sends a ui_change',
    })
    .toBeDefined();
  const { changeId } = found(uiChangeFor(frames, runId), 'ui_change event');

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
    .poll(() => uiAppliedFor(frames, changeId), {
      message: 'the page acknowledges the ui_change with ui_applied',
    })
    .toBeDefined();
  const uiApplied = found(uiAppliedFor(frames, changeId), 'ui_applied input');
  expect(uiApplied.actionOutcomes.every((outcome) => outcome.ok)).toBe(true);

  const runEvents = receivedAgentEvents(frames);
  const runErrors = runEvents.filter(
    (event) =>
      event.type === 'error' &&
      (event.runId === runId || event.changeId === changeId),
  );
  expect(runErrors).toEqual([]);
  const finished = runEvents.find(
    (event): event is AgentFinishedEvent =>
      event.type === 'finished' && event.runId === runId,
  );
  expect(finished?.reason).not.toBe('error');
});

function sentUtterance(
  frames: readonly CollectedFrame[],
): AgentUtteranceInput | undefined {
  return sentAgentInputs(frames).find(
    (input): input is AgentUtteranceInput =>
      input.type === 'utterance' && input.text === UTTERANCE,
  );
}

function acceptedFor(
  frames: readonly CollectedFrame[],
  inputId: MessageId,
): AgentAcceptedEvent | undefined {
  return receivedAgentEvents(frames).find(
    (event): event is AgentAcceptedEvent =>
      event.type === 'accepted' && event.inputId === inputId,
  );
}

function uiChangeFor(
  frames: readonly CollectedFrame[],
  runId: RunId | null,
): AgentUiChangeEvent | undefined {
  return receivedAgentEvents(frames).find(
    (event): event is AgentUiChangeEvent =>
      event.type === 'ui_change' && event.runId === runId,
  );
}

function uiAppliedFor(
  frames: readonly CollectedFrame[],
  changeId: ChangeId,
): AgentUiAppliedInput | undefined {
  return sentAgentInputs(frames).find(
    (input): input is AgentUiAppliedInput =>
      input.type === 'ui_applied' && input.changeId === changeId,
  );
}

function found<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Expected a ${what}`);
  return value;
}
