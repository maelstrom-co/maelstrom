import type { Message } from '@ag-ui/core';
import {
  MessagesSnapshotEventSchema,
  RunAgentInputSchema,
} from '@ag-ui/core/schemas';
import {
  chat,
  chatParamsFromRequestBody,
  type ModelMessage,
  maxIterations,
  type StreamChunk,
  toolDefinition,
  toServerSentEventsResponse,
} from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';
import { z } from 'zod';
import { toAgui } from './boundary.js';
import {
  type Ack,
  AckSchema,
  type Apply,
  applyTool,
  emptySnapshot,
  frontendTools,
  RecordSchema,
} from './contracts.js';
import { candidate, plan } from './planner.js';
import type { FixtureStore } from './workspace.js';

function toolResult(messages: ModelMessage[], id: string): unknown {
  const result = messages.findLast(
    (m) => m.role === 'tool' && m.toolCallId === id,
  );
  if (!result || typeof result.content !== 'string')
    throw new Error(`Missing tool result: ${id}`);
  return JSON.parse(result.content);
}

export class Host {
  readonly trace: StreamChunk[] = [];
  readonly childTrace: StreamChunk[] = [];
  readonly accepted: Ack[] = [];
  private run = 0;
  private pending?: { id: string; input: Apply };
  private active = false;
  private ended = false;
  private history: Message[] = [];

  constructor(
    private readonly store: FixtureStore,
    private readonly childGate?: (signal: AbortSignal) => Promise<void>,
  ) {}

  async handle(request: Request): Promise<Response> {
    if (request.method !== 'POST')
      return new Response('POST required', { status: 405 });
    if (request.signal.aborted)
      return new Response('Aborted before dispatch', { status: 409 });
    const text = await request.text();
    if (text.length > 65536)
      return new Response('Input too large', { status: 413 });
    let body: z.infer<typeof RunAgentInputSchema>;
    try {
      body = RunAgentInputSchema.parse(JSON.parse(text));
    } catch {
      return new Response('Invalid AG-UI input', { status: 400 });
    }
    const params = await chatParamsFromRequestBody(body).catch(() => undefined);
    if (!params)
      return new Response('Unsupported TanStack input shape', { status: 400 });
    if (request.signal.aborted)
      return new Response('Aborted before dispatch', { status: 409 });
    if (
      this.active ||
      this.ended ||
      this.run >= 3 ||
      body.threadId !== 'workspace-poc' ||
      body.runId !== `run-${this.run + 1}` ||
      body.parentRunId !== (this.run ? `run-${this.run}` : undefined)
    )
      return new Response('Stale, duplicate, or unavailable run', {
        status: 409,
      });
    if (
      body.resume?.length ||
      JSON.stringify(body.tools) !== JSON.stringify(frontendTools) ||
      body.context.length ||
      Object.keys(body.forwardedProps ?? {}).length
    )
      return new Response('Unsupported input extensions', { status: 400 });
    let ack: Ack | undefined;
    if (this.pending) {
      if (
        JSON.stringify(body.messages.slice(0, -1)) !==
        JSON.stringify(this.history)
      )
        return new Response('History changed', { status: 409 });
      const result = body.messages.at(-1);
      if (
        result?.role !== 'tool' ||
        result.toolCallId !== this.pending.id ||
        typeof result.content !== 'string'
      )
        return new Response('Pending frontend result required', {
          status: 409,
        });
      try {
        ack = AckSchema.parse(JSON.parse(result.content));
      } catch {
        return new Response('Invalid acknowledgment', { status: 400 });
      }
      if (
        ack.callId !== this.pending.id ||
        ack.requestId !== this.pending.input.response.requestId ||
        ack.revision !== this.pending.input.expectedRevision + 1
      )
        return new Response('Stale acknowledgment', { status: 409 });
      const expected = this.pending.input.response.executionPlan;
      if (
        ack.actions.length !== expected.length ||
        ack.actions.some(
          (a, i) =>
            a.instanceId !== expected[i]?.instanceId ||
            a.action !== expected[i]?.action,
        )
      )
        return new Response('Uncorrelated Action outcomes', { status: 409 });
      if (
        ack.status === 'applied' &&
        ack.actions.some((a) => a.status !== 'succeeded')
      )
        return new Response('Inconsistent acknowledgment', { status: 400 });
    } else if (
      this.run !== 0 ||
      body.messages.length !== 1 ||
      body.messages[0]?.role !== 'user'
    ) {
      return new Response('One initial user goal required', { status: 400 });
    }
    this.active = true;
    this.run++;
    if (ack) this.accepted.push(ack);
    this.pending = undefined;
    const controller = new AbortController();
    const abort = () => {
      this.ended = true;
      controller.abort();
    };
    request.signal.addEventListener('abort', abort, { once: true });
    const adapter = fakeText();
    const lookup = toolDefinition({
      name: 'delegate_lookup',
      description: 'Delegate an explicit read of the created note.',
      inputSchema: z.object({}),
      outputSchema: RecordSchema,
    }).server(async (_input, context) => {
      const signal = context?.abortSignal;
      if (!signal) throw new Error('Missing parent abort signal');
      const childController = new AbortController();
      const cancelChild = () => childController.abort();
      signal.addEventListener('abort', cancelChild, { once: true });
      if (signal.aborted) cancelChild();
      const child = fakeText();
      child.setResponses([
        { toolCalls: [{ id: 'read-1', name: 'read_created_note', input: {} }] },
        ({ request: childRequest }) => ({
          text: JSON.stringify(
            RecordSchema.parse(toolResult(childRequest.messages, 'read-1')),
          ),
        }),
      ]);
      const read = toolDefinition({
        name: 'read_created_note',
        description:
          'Read the local record, including its canonical ID and version.',
        inputSchema: z.object({}),
        outputSchema: RecordSchema,
      }).server(async () => {
        await this.childGate?.(childController.signal);
        childController.signal.throwIfAborted();
        return this.store.read();
      });
      try {
        let result = '';
        for await (const event of chat({
          adapter: child,
          messages: [{ role: 'user', content: 'Read the created record.' }],
          tools: [read],
          threadId: 'workspace-poc:lookup',
          runId: 'child-1',
          abortController: childController,
          agentLoopStrategy: maxIterations(3),
          debug: false,
        })) {
          this.childTrace.push(event);
          if (event.type === 'TEXT_MESSAGE_CONTENT') result += event.delta;
          if (event.type === 'RUN_ERROR') throw new Error('Child read failed');
        }
        childController.signal.throwIfAborted();
        return RecordSchema.parse(JSON.parse(result));
      } finally {
        signal.removeEventListener('abort', cancelChild);
      }
    });
    if (ack && ack.status !== 'applied') {
      adapter.setResponses([
        { text: 'Workspace outcome is uncertain. Stopped without retry.' },
      ]);
    } else if (this.run === 1) {
      adapter.setResponses([
        async () => {
          const input = {
            expectedRevision: 0,
            response: await plan(emptySnapshot, 'change-1'),
          };
          this.pending = { id: 'apply-1', input };
          return {
            toolCalls: [{ id: 'apply-1', name: applyTool.name, input }],
          };
        },
      ]);
    } else if (this.run === 2 && ack) {
      const settled = ack;
      adapter.setResponses([
        ({ request: modelRequest }) => {
          AckSchema.parse(toolResult(modelRequest.messages, 'apply-1'));
          return {
            toolCalls: [{ id: 'lookup-1', name: lookup.name, input: {} }],
          };
        },
        async ({ request: modelRequest }) => {
          const fact = RecordSchema.parse(
            toolResult(modelRequest.messages, 'lookup-1'),
          );
          const input = {
            expectedRevision: settled.revision,
            response: await plan(settled.snapshot, 'change-2', candidate(fact)),
          };
          this.pending = { id: 'apply-2', input };
          return {
            toolCalls: [{ id: 'apply-2', name: applyTool.name, input }],
          };
        },
      ]);
    } else {
      adapter.setResponses([
        ({ request: modelRequest }) => {
          AckSchema.parse(toolResult(modelRequest.messages, 'apply-2'));
          return {
            text: 'Created and focused the note. Both workspace changes settled.',
          };
        },
      ]);
    }
    const stream = chat({
      adapter,
      messages: params.messages,
      threadId: params.threadId,
      runId: params.runId,
      parentRunId: params.parentRunId,
      resume: ack
        ? [
            {
              interruptId: `client_tool_${ack.callId}`,
              status: 'resolved',
              payload: ack,
            },
          ]
        : undefined,
      tools: [applyTool, lookup],
      abortController: controller,
      agentLoopStrategy: maxIterations(4),
      debug: false,
    });
    const host = this;
    async function* observed(): AsyncIterable<StreamChunk> {
      try {
        for await (const event of stream) {
          host.trace.push(event);
          if (event.type === 'MESSAGES_SNAPSHOT')
            host.history = MessagesSnapshotEventSchema.parse(event).messages;
          yield event;
        }
      } finally {
        host.active = false;
        if (!host.pending || controller.signal.aborted) host.ended = true;
        request.signal.removeEventListener('abort', abort);
      }
    }
    return toServerSentEventsResponse(toAgui(observed()), {
      abortController: controller,
    });
  }
}
