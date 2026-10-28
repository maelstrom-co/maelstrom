import { defineAgent, maxIterations, toolDefinition } from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';
import { z } from 'zod';
import { RecordSchema } from './contracts.js';
import type { FixtureStore } from './workspace.js';

export const lookupOutcome = z.union([
  RecordSchema,
  z.object({ denied: z.literal(true) }),
]);

export class ApprovedLookup {
  readonly identities: string[] = [];
  reads = 0;

  constructor(
    private readonly store: FixtureStore,
    private readonly gate?: (signal: AbortSignal) => Promise<void>,
  ) {}

  readonly agent = defineAgent({
    name: 'record-reader',
    description: 'Read the created record after fixture approval.',
    run: (ctx) => {
      this.identities.push(ctx.subagentRunId);
      const read = toolDefinition({
        name: 'read_approved_record',
        description: 'Read the canonical ID and version.',
        inputSchema: z.object({}),
        outputSchema: RecordSchema,
        needsApproval: true,
      }).server(async () => {
        const signal = ctx.abortSignal;
        if (!signal) throw new Error('Missing child abort signal');
        await this.gate?.(signal);
        signal.throwIfAborted();
        this.reads++;
        return this.store.read();
      });
      const adapter = fakeText();
      adapter.setResponses(
        ctx.resume?.length
          ? [
              ({ request }) => {
                if (ctx.resume?.[0]?.payload === false)
                  return { text: JSON.stringify({ denied: true }) };
                const result = request.messages.findLast(
                  (message) =>
                    message.role === 'tool' &&
                    message.toolCallId === 'approved-read',
                );
                if (typeof result?.content !== 'string')
                  throw new Error('Missing approved read result');
                return {
                  text: JSON.stringify(
                    RecordSchema.parse(JSON.parse(result.content)),
                  ),
                };
              },
            ]
          : [
              {
                toolCalls: [
                  { id: 'approved-read', name: read.name, input: {} },
                ],
              },
            ],
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
}
