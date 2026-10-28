import { expect, test } from 'bun:test';
import {
  chat,
  chatParamsFromRequestBody,
  defineAgent,
  maxIterations,
  type StreamChunk,
  StreamProcessor,
  toolDefinition,
  toServerSentEventsResponse,
  uiMessagesToWire,
} from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';
import { z } from 'zod';
import { decode } from './wire.js';

test.each([
  true,
  false,
])('a real subagent resumes the same child and honors approval=%s', async (approved) => {
  let reads = 0;
  const identities: string[] = [];
  const read = toolDefinition({
    name: 'read_record',
    description: 'Read the record after fixture approval.',
    inputSchema: z.object({}),
    needsApproval: true,
  }).server(() => {
    reads++;
    return { id: 'child-record-91', version: 4 };
  });
  const child = defineAgent({
    name: 'reader',
    description: 'Read the canonical record.',
    run: (ctx) => {
      identities.push(ctx.subagentRunId);
      const adapter = fakeText();
      adapter.setResponses(
        ctx.resume?.length
          ? [
              ({ request }) => ({
                text: JSON.stringify(
                  request.messages.findLast((m) => m.role === 'tool')?.content,
                ),
              }),
            ]
          : [{ toolCalls: [{ id: 'child-read', name: read.name, input: {} }] }],
      );
      return ctx.chat({
        adapter,
        messages: ctx.messages,
        ...ctx.forward,
        tools: [read],
        agentLoopStrategy: maxIterations(3),
        debug: false,
      });
    },
  });
  const subagents = { agents: [child], router: () => 'reader' };
  const processor = new StreamProcessor({
    initialMessages: [
      {
        id: 'goal',
        role: 'user',
        parts: [{ type: 'text', content: 'Read the record.' }],
      },
    ],
  });
  async function* observed(stream: AsyncIterable<StreamChunk>) {
    for await (const event of stream) {
      processor.processChunk(event);
      yield event;
    }
  }
  const first = await decode(
    toServerSentEventsResponse(
      observed(
        chat({
          adapter: fakeText(),
          messages: [{ role: 'user', content: 'Read the record.' }],
          threadId: 'child-proof',
          runId: 'parent-1',
          subagents,
          debug: false,
        }),
      ),
    ),
  );
  expect(reads).toBe(0);
  const terminal = first.at(-1);
  if (
    terminal?.type !== 'RUN_FINISHED' ||
    terminal.outcome?.type !== 'interrupt'
  )
    throw new Error('Expected a child approval interrupt');
  const interrupt = terminal.outcome.interrupts[0];
  if (!interrupt) throw new Error('Missing interrupt');
  const params = await chatParamsFromRequestBody({
    threadId: 'child-proof',
    runId: 'parent-2',
    parentRunId: 'parent-1',
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    messages: uiMessagesToWire(processor.getMessages()),
    resume: [
      { interruptId: interrupt.id, status: 'resolved', payload: approved },
    ],
  });
  const second = await decode(
    toServerSentEventsResponse(
      chat({
        adapter: fakeText(),
        ...params,
        subagents,
        debug: false,
      }),
    ),
  );
  expect(reads).toBe(approved ? 1 : 0);
  expect(identities).toHaveLength(2);
  expect(identities[1]).toBe(identities[0]);
  expect(JSON.stringify(second).includes('child-record-91')).toBe(approved);
  expect(second.at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
  expect(second.some((event) => event.type === 'SUBAGENT_FINISHED')).toBe(true);
  const finished = second.at(-1);
  if (finished?.type === 'RUN_FINISHED') {
    expect(finished.outcome?.type === 'interrupt').toBe(false);
  }
  expect(processor.getMessages().filter((m) => m.role === 'user')).toHaveLength(
    1,
  );
});
