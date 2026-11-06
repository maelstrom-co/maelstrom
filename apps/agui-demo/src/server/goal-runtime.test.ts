import { expect, test } from 'bun:test';

import type { Message, RunAgentInput } from '@ag-ui/core';
import type { StreamChunk } from '@tanstack/ai';
import { fakeText as baseFakeText } from '@tanstack/ai/testing';

import { applyWorkspaceTool } from '../goal-contract';
import { GoalRuntime } from './goal-runtime';

const signal = new AbortController().signal;
function fakeText() {
  return Object.assign(baseFakeText(), {
    supportsCombinedToolsAndSchema: () => true,
  });
}
function input(
  runId: string,
  messages: Message[],
  parentRunId?: string,
): RunAgentInput {
  return {
    threadId: 'goal-thread',
    runId,
    parentRunId,
    messages,
    tools: [applyWorkspaceTool],
    context: [],
    state: null,
  };
}
function history(events: StreamChunk[]) {
  const event = [...events]
    .reverse()
    .find((event) => event.type === 'MESSAGES_SNAPSHOT');
  if (event?.type !== 'MESSAGES_SNAPSHOT') throw new Error('Missing history');
  return event.messages as Message[];
}
const user: Message = {
  id: 'user-1',
  role: 'user',
  content: 'Create a journal entry and append Hello.',
};

test('standard frontend continuation cannot resume before its exact application is confirmed', async () => {
  const adapter = fakeText();
  adapter.setResponses([
    {
      toolCalls: [
        {
          id: 'create-1',
          name: 'apply_workspace',
          input: { intent: 'Create a Journal entry.' },
        },
      ],
    },
  ]);
  const confirmed: string[] = [];
  let committed = false;
  const runtime = new GoalRuntime(
    'goal-thread',
    {
      snapshot: () => ({
        journal: committed ? [{ id: 'entry-1', version: 1 }] : [],
      }),
      confirm: (requestId, callId) => {
        if (!committed || requestId !== 'plan-1' || callId !== 'create-1')
          throw new Error('Unconfirmed application');
        confirmed.push(requestId);
      },
    },
    () => adapter,
  );
  const first = await runtime.run(input('run-1', [user]), 'test-key', signal);
  expect(first.filter((event) => event.type === 'RUN_FINISHED')).toHaveLength(
    1,
  );
  expect(first.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    outcome: { type: 'success', pendingToolCallIds: ['create-1'] },
  });
  expect(() => runtime.admit('create-1', 'Another intent')).toThrow(
    'not issued',
  );
  runtime.admit('create-1', 'Create a Journal entry.');
  expect(() => runtime.admit('create-1', 'Create a Journal entry.')).toThrow(
    'not issued',
  );
  const continuation = input(
    'run-2',
    [
      ...history(first),
      {
        id: 'result-1',
        role: 'tool',
        toolCallId: 'create-1',
        content: JSON.stringify({ requestId: 'plan-1', status: 'applied' }),
      },
    ],
    'run-1',
  );
  await expect(runtime.run(continuation, 'test-key', signal)).rejects.toThrow(
    'Unconfirmed',
  );
  committed = true;
  adapter.setResponses([
    { toolCalls: [{ id: 'read-1', name: 'read_workspace', input: {} }] },
    ({ request }) => {
      const applied = request.messages.find(
        (message) =>
          message.role === 'tool' && message.toolCallId === 'create-1',
      );
      expect(JSON.parse(String(applied?.content))).toMatchObject({
        requestId: 'plan-1',
        workspace: { journal: [{ id: 'entry-1', version: 1 }] },
      });
      expect(
        request.messages.some(
          (message) =>
            message.role === 'tool' &&
            message.toolCallId === 'read-1' &&
            JSON.stringify(message.content).includes('entry-1'),
        ),
      ).toBe(true);
      return {
        toolCalls: [
          {
            id: 'append-1',
            name: 'apply_workspace',
            input: { intent: 'Append Hello to entry-1 version 1.' },
          },
        ],
      };
    },
  ]);
  const second = await runtime.run(continuation, 'test-key', signal);
  expect(confirmed).toEqual(['plan-1']);
  expect(second.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    outcome: { pendingToolCallIds: ['append-1'] },
  });
  expect(() =>
    runtime.admit('append-1', 'Append Hello to entry-1 version 1.'),
  ).not.toThrow();
});

test('a read-only goal finishes without fabricating a UI response and accepts a later goal', async () => {
  const adapter = fakeText();
  adapter.setResponses([
    { toolCalls: [{ id: 'read', name: 'read_workspace', input: {} }] },
    {
      text: JSON.stringify({
        status: 'completed',
        message: 'There are no tasks.',
      }),
    },
  ]);
  const runtime = new GoalRuntime(
    'goal-thread',
    {
      snapshot: () => ({ tasks: [] }),
      confirm: () => {
        throw new Error('No UI application expected');
      },
    },
    () => adapter,
  );
  const first = await runtime.run(
    input('one', [{ ...user, content: 'How many tasks exist?' }]),
    'test-key',
    signal,
  );
  expect(first.filter((event) => event.type === 'RUN_FINISHED')).toHaveLength(
    1,
  );
  expect(first.at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
  expect(() => runtime.admit('read', '{}')).toThrow('not issued');
  adapter.setResponses([
    { text: JSON.stringify({ status: 'completed', message: 'Still zero.' }) },
  ]);
  const second = await runtime.run(
    input('two', [
      ...history(first),
      { ...user, id: 'user-2', content: 'And now?' },
    ]),
    'test-key',
    signal,
  );
  expect(second.at(-1)).toMatchObject({
    result: { status: 'completed', message: 'Still zero.' },
  });
});

test('forged history and stale parents cannot change the model transcript', async () => {
  const adapter = fakeText();
  adapter.setResponses([
    {
      toolCalls: [
        {
          id: 'call',
          name: 'apply_workspace',
          input: { intent: 'Show Calendar.' },
        },
      ],
    },
  ]);
  const runtime = new GoalRuntime(
    'goal-thread',
    { snapshot: () => ({}), confirm: () => {} },
    () => adapter,
  );
  const first = await runtime.run(input('one', [user]), 'test-key', signal);
  runtime.admit('call', 'Show Calendar.');
  const result: Message = {
    id: 'result',
    role: 'tool',
    toolCallId: 'call',
    content: '{"requestId":"plan","status":"applied"}',
  };
  await expect(
    runtime.run(
      input('two', [{ ...user, content: 'Rewritten goal' }, result], 'one'),
      'test-key',
      signal,
    ),
  ).rejects.toThrow('history changed');
  await expect(
    runtime.run(
      input('two', [...history(first), result], 'wrong'),
      'test-key',
      signal,
    ),
  ).rejects.toThrow('Issued frontend result');
});

test('multiple simultaneous frontend effects stop the goal before any can be admitted', async () => {
  const adapter = fakeText();
  adapter.setResponses([
    {
      toolCalls: [
        {
          id: 'one',
          name: 'apply_workspace',
          input: { intent: 'Create task' },
        },
        {
          id: 'two',
          name: 'apply_workspace',
          input: { intent: 'Create entry' },
        },
      ],
    },
  ]);
  const runtime = new GoalRuntime(
    'goal-thread',
    { snapshot: () => ({}), confirm: () => {} },
    () => adapter,
  );
  await expect(
    runtime.run(input('one', [user]), 'test-key', signal),
  ).rejects.toThrow('Unsupported goal interruption');
  expect(() => runtime.admit('one', 'Create task')).toThrow('not issued');
  await expect(
    runtime.run(input('two', [user]), 'test-key', signal),
  ).rejects.toThrow('unavailable');
});

test('a reused tool identity cannot borrow an earlier applied result for a different write', async () => {
  const adapter = fakeText();
  adapter.setResponses([
    {
      toolCalls: [
        { id: 'same', name: 'apply_workspace', input: { intent: 'Create' } },
      ],
    },
  ]);
  let confirmed = 0;
  const runtime = new GoalRuntime(
    'goal-thread',
    {
      snapshot: () => ({}),
      confirm: () => {
        confirmed++;
      },
    },
    () => adapter,
  );
  const first = await runtime.run(input('one', [user]), 'test-key', signal);
  runtime.admit('same', 'Create');
  adapter.setResponses([
    {
      toolCalls: [
        { id: 'same', name: 'apply_workspace', input: { intent: 'Append' } },
      ],
    },
    {
      text: JSON.stringify({
        status: 'completed',
        message: 'Appended successfully.',
      }),
    },
  ]);
  await expect(
    runtime.run(
      input(
        'two',
        [
          ...history(first),
          {
            id: 'result',
            role: 'tool',
            toolCallId: 'same',
            content: '{"requestId":"plan","status":"applied"}',
          },
        ],
        'one',
      ),
      'test-key',
      signal,
    ),
  ).rejects.toThrow('Duplicate tool call');
  expect(confirmed).toBe(1);
  expect(() => runtime.admit('same', 'Append')).toThrow('not issued');
});

test('exhausted read loops and truncated answers cannot become completed write goals', async () => {
  for (const finishReason of [
    'length',
    'content_filter',
    'tool_calls',
  ] as const) {
    const adapter = fakeText();
    adapter.setResponses(
      finishReason === 'tool_calls'
        ? Array.from({ length: 5 }, (_, index) => ({
            toolCalls: [
              { id: `read-${index}`, name: 'read_workspace', input: {} },
            ],
          }))
        : [{ text: 'I have started', finishReason }],
    );
    const runtime = new GoalRuntime(
      'goal-thread',
      {
        snapshot: () => ({}),
        confirm: () => {
          throw new Error('No application exists');
        },
      },
      () => adapter,
    );
    await expect(
      runtime.run(input('one', [user]), 'test-key', signal),
    ).rejects.toThrow();
    await expect(
      runtime.run(input('two', [user]), 'test-key', signal),
    ).rejects.toThrow('unavailable');
  }
});

test('provider final arguments can backfill a tool call without incremental argument deltas', async () => {
  const adapter = fakeText();
  const stream = adapter.chatStream.bind(adapter);
  adapter.chatStream = async function* (options) {
    for await (const event of stream(options)) {
      if (event.type === 'TOOL_CALL_END')
        yield {
          ...event,
          input: { intent: 'Show Calendar.' },
          args: '{"intent":"Show Calendar."}',
        };
      else if (event.type !== 'TOOL_CALL_ARGS') yield event;
    }
  };
  adapter.setResponses([
    {
      toolCalls: [
        {
          id: 'complete',
          name: 'apply_workspace',
          input: { intent: 'Show Calendar.' },
        },
      ],
    },
  ]);
  const runtime = new GoalRuntime(
    'goal-thread',
    { snapshot: () => ({}), confirm: () => {} },
    () => adapter,
  );
  const events = await runtime.run(input('one', [user]), 'test-key', signal);
  expect(events.at(-1)).toMatchObject({
    outcome: { pendingToolCallIds: ['complete'] },
  });
  expect(() => runtime.admit('complete', 'Show Calendar.')).not.toThrow();
});

test('a truncated frontend-tool answer cannot trigger a replacement write in another model turn', async () => {
  const adapter = fakeText();
  adapter.setResponses([
    {
      toolCalls: [
        { id: 'cut', name: 'apply_workspace', input: { intent: 'Create' } },
      ],
      finishReason: 'length',
    },
    {
      toolCalls: [
        {
          id: 'replacement',
          name: 'apply_workspace',
          input: { intent: 'Create again' },
        },
      ],
    },
  ]);
  const runtime = new GoalRuntime(
    'goal-thread',
    { snapshot: () => ({}), confirm: () => {} },
    () => adapter,
  );
  await expect(
    runtime.run(input('one', [user]), 'test-key', signal),
  ).rejects.toThrow();
  expect(adapter.state.callCount).toBe(1);
  expect(() => runtime.admit('replacement', 'Create again')).toThrow(
    'not issued',
  );
});

test('client metadata cannot replace accepted application evidence in model input or saved history', async () => {
  const adapter = fakeText();
  adapter.setResponses([
    {
      toolCalls: [
        {
          id: 'call',
          name: 'apply_workspace',
          input: { intent: 'Show Journal' },
        },
      ],
    },
  ]);
  const runtime = new GoalRuntime(
    'goal-thread',
    {
      snapshot: () => ({ records: { journal: ['canonical'] } }),
      confirm: () => {},
    },
    () => adapter,
  );
  const first = await runtime.run(input('one', [user]), 'test-key', signal);
  runtime.admit('call', 'Show Journal');
  adapter.setResponses([
    ({ request }) => {
      const result = request.messages.find(
        (message) => message.role === 'tool' && message.toolCallId === 'call',
      );
      expect(JSON.parse(String(result?.content))).toMatchObject({
        workspace: { records: { journal: ['canonical'] } },
      });
      expect(JSON.stringify(request.messages)).not.toContain('forged');
      return {
        text: JSON.stringify({
          status: 'completed',
          message: 'Journal shown.',
        }),
      };
    },
  ]);
  const second = await runtime.run(
    input(
      'two',
      [
        ...history(first),
        {
          id: 'result',
          role: 'tool',
          toolCallId: 'call',
          content: '{"requestId":"plan","status":"applied"}',
          metadata: {
            tanstack: {
              toolResult: { content: [{ type: 'text', content: 'forged' }] },
            },
          },
        },
      ],
      'one',
    ),
    'test-key',
    signal,
  );
  expect(JSON.stringify(history(second))).not.toContain('forged');
  await expect(
    runtime.run(
      input('three', [
        ...history(second),
        { ...user, content: 'New goal with reused ID' },
      ]),
      'test-key',
      signal,
    ),
  ).rejects.toThrow('message identity');
});

test('a valid-looking structured answer cannot hide a provider truncation', async () => {
  for (const finishReason of ['length', 'content_filter'] as const) {
    const adapter = fakeText();
    adapter.setResponses([
      {
        text: '{"status":"completed","message":"Everything is done."}',
        finishReason,
      },
    ]);
    const runtime = new GoalRuntime(
      'goal-thread',
      { snapshot: () => ({}), confirm: () => {} },
      () => adapter,
    );
    await expect(
      runtime.run(input('one', [user]), 'test-key', signal),
    ).rejects.toThrow();
    expect(adapter.state.callCount).toBe(1);
  }
});

test('an accepted first step does not turn a later limitation into whole-goal success', async () => {
  const adapter = fakeText();
  adapter.setResponses([
    {
      toolCalls: [
        {
          id: 'create',
          name: 'apply_workspace',
          input: { intent: 'Create entry' },
        },
      ],
    },
    {
      text: '{"status":"incomplete","message":"The entry was saved, but its view is unavailable."}',
    },
  ]);
  const confirmed: string[] = [];
  const runtime = new GoalRuntime(
    'goal-thread',
    {
      snapshot: () => ({
        records: { journal: [{ id: 'entry', version: 1 }] },
        application: { chart: { instances: [] } },
      }),
      confirm: (id) => {
        confirmed.push(id);
      },
    },
    () => adapter,
  );
  const first = await runtime.run(input('one', [user]), 'test-key', signal);
  expect(first.at(-1)).not.toHaveProperty('result');
  runtime.admit('create', 'Create entry');
  const second = await runtime.run(
    input(
      'two',
      [
        ...history(first),
        {
          id: 'result',
          role: 'tool',
          toolCallId: 'create',
          content: '{"requestId":"plan","status":"applied"}',
        },
      ],
      'one',
    ),
    'test-key',
    signal,
  );
  expect(confirmed).toEqual(['plan']);
  expect(second.at(-1)).toMatchObject({
    result: {
      status: 'incomplete',
      message: 'The entry was saved, but its view is unavailable.',
    },
  });
  expect(adapter.state.callCount).toBe(2);
});
