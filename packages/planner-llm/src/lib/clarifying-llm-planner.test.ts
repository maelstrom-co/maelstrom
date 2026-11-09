import { afterEach, describe, expect, mock, test } from 'bun:test';

import {
  buildGridResponse,
  makeGridRequest,
  makePlanningInput,
  makeStageContext,
  makeTilingRequest,
} from '@maelstrom-co/engine/_testing';
import type { ChartRequest, LayoutMode } from '@maelstrom-co/protocol';
import {
  GridModelOutputSchema,
  isOk,
  TilingModelOutputSchema,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter, ChatMiddleware } from '@tanstack/ai';
import { convertSchemaToJsonSchema } from '@tanstack/ai';

import {
  dummyAdapter,
  overflowDiagnostics,
} from './__test-helpers__/fixtures.js';
import { clarifyingLlmPlanner, llmPlanner } from './llm-planner.js';
import type { PromptOptions } from './prompt/prompt-builder.js';
import {
  buildReplylessSystemPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from './prompt/prompt-builder.js';
import { buildRetryPrompt } from './retry-prompt.js';
import { skipReplyOutputSchemaFor } from './skip-reply-output.js';

const mockChat = mock<(...args: unknown[]) => Promise<unknown>>();
const convertOutputSchema = convertSchemaToJsonSchema;

mock.module('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  convertSchemaToJsonSchema: convertOutputSchema,
}));

afterEach(() => {
  mockChat.mockReset();
});

interface ChatArgs {
  readonly adapter: AnyTextAdapter;
  readonly threadId: string;
  readonly messages: ReadonlyArray<{ role: string; content: string }>;
  readonly systemPrompts: readonly string[];
  readonly outputSchema: unknown;
  readonly middleware: readonly ChatMiddleware[];
  readonly abortController: AbortController;
}

const modes: readonly LayoutMode[] = ['grid', 'tiling'];

const replylessOutputs = {
  grid: {
    rationale: 'Top left has room.',
    executionPlan: [],
    layout: {
      positions: [
        {
          instanceId: 'calendar-main',
          position: { row: 0, column: 0 },
          size: { width: 6, height: 4 },
        },
      ],
    },
  },
  tiling: {
    rationale: 'Two panes side by side.',
    executionPlan: [],
    layout: {
      tree: ['H', 'ID:calendar-main', 'ID:notes-main'],
      instances: [
        {
          instanceId: 'calendar-main',
          vesselId: 'calendar',
          variant: 'month',
        },
        { instanceId: 'notes-main', vesselId: 'notes', variant: 'list' },
      ],
    },
  },
} as const;

const partialExecutionPlan = [
  {
    instanceId: 'calendar-main',
    action: 'showWeek',
    paramsJson: '{"view":"week"}',
  },
];

describe.each(modes)('clarifyingLlmPlanner (%s)', (mode) => {
  test('without skipReply sends the same chat() call and returns the same candidate as llmPlanner', async () => {
    for (const skipReply of [undefined, false] as const) {
      const request = withSkipReply(requestFor(mode), skipReply);
      const prompt: PromptOptions = { vars: { assistantName: 'Aria' } };
      const modelOptions = { max_output_tokens: 1234 };
      const reply = replyBearingOutputFor(mode);
      mockChat.mockResolvedValue(reply);
      const input = makePlanningInput(request);
      const ctx = makeStageContext({ origin: input });

      const strict = await llmPlanner({
        adapter: dummyAdapter,
        prompt,
        modelOptions,
      })(input, ctx);
      const strictCalls = comparableChatCalls();
      mockChat.mockClear();
      const clarifying = await clarifyingLlmPlanner({
        adapter: dummyAdapter,
        prompt,
        modelOptions,
      })(input, ctx);

      expect(comparableChatCalls()).toEqual(strictCalls);
      expect(chatCall(0).systemPrompts).toEqual([
        buildSystemPrompt(mode, prompt),
      ]);
      expect(chatCall(0).outputSchema).toEqual(
        convertOutputSchema(
          mode === 'grid' ? GridModelOutputSchema : TilingModelOutputSchema,
        ),
      );
      expect(clarifying).toEqual(strict);
      expect(isOk(clarifying)).toBe(true);
      if (!isOk(clarifying)) return;
      expect(clarifying.value).toMatchObject({
        type: 'plan',
        userMessage: reply.userMessage,
      });
      mockChat.mockReset();
    }
  });

  test('with skipReply sends the reply-free prompt and schema with the default user message', async () => {
    const request = withSkipReply(requestFor(mode), true);
    mockChat.mockResolvedValueOnce(replylessOutputs[mode]);
    const input = makePlanningInput(request);

    await clarifyingLlmPlanner({ adapter: dummyAdapter })(
      input,
      makeStageContext({ origin: input }),
    );

    const call = chatCall(0);
    expect(call.outputSchema).toEqual(
      convertOutputSchema(skipReplyOutputSchemaFor(mode)),
    );
    expect(JSON.stringify(call.outputSchema)).not.toContain('userMessage');
    expect(call.systemPrompts).toEqual([buildReplylessSystemPrompt(mode)]);
    expect(call.systemPrompts[0]).not.toContain('userMessage');
    expect(call.messages).toEqual([
      { role: 'user', content: buildUserPrompt(request) },
    ]);
  });

  test('with skipReply returns a tagged plan without userMessage when the model asks nothing', async () => {
    mockChat.mockResolvedValueOnce(replylessOutputs[mode]);

    const result = await runWithSkipReply(mode);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect<unknown>(result.value).toEqual({
      type: 'plan',
      ...replylessOutputs[mode],
    });
    expect(result.value).not.toHaveProperty('userMessage');
    expect(result.value).not.toHaveProperty('clarification');
  });

  test('with skipReply returns needs-clarification when the model asks a question', async () => {
    mockChat.mockResolvedValueOnce({
      ...replylessOutputs[mode],
      executionPlan: [],
      clarification: {
        question: 'Which calendar?',
        options: ['Work', 'Personal'],
      },
    });

    const result = await runWithSkipReply(mode);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect<unknown>(result.value).toEqual({
      type: 'needs_clarification',
      question: 'Which calendar?',
      options: ['Work', 'Personal'],
      layout: replylessOutputs[mode].layout,
      executionPlan: [],
    });
  });

  test('with skipReply carries a partial layout and executionPlan on the clarification', async () => {
    mockChat.mockResolvedValueOnce({
      ...replylessOutputs[mode],
      executionPlan: partialExecutionPlan,
      clarification: { question: 'Which week should it show?' },
    });

    const result = await runWithSkipReply(mode);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect<unknown>(result.value).toEqual({
      type: 'needs_clarification',
      question: 'Which week should it show?',
      layout: replylessOutputs[mode].layout,
      executionPlan: partialExecutionPlan,
    });
  });

  test('with skipReply maps an unsupported capability to a clarification naming the gap', async () => {
    const question =
      'Video playback is not supported. Show the calendar or the notes instead?';
    mockChat.mockResolvedValueOnce({
      ...replylessOutputs[mode],
      executionPlan: partialExecutionPlan,
      clarification: {
        question,
        options: ['Show the calendar', 'Show the notes'],
      },
    });

    const result = await runWithSkipReply(mode);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect<unknown>(result.value).toEqual({
      type: 'needs_clarification',
      question,
      options: ['Show the calendar', 'Show the notes'],
      layout: replylessOutputs[mode].layout,
      executionPlan: partialExecutionPlan,
    });
  });

  test('a skipReply retry keeps the reply-free system prompt and sends the retry prompt', async () => {
    mockChat.mockResolvedValue(replylessOutputs[mode]);
    const request = withSkipReply(requestFor(mode), true);
    const input = makePlanningInput(request);
    const ctx = makeStageContext({ origin: input });
    const planner = clarifyingLlmPlanner({ adapter: dummyAdapter });
    const first = await planner(input, ctx);
    if (!isOk(first) || first.value.type !== 'plan')
      throw new Error('first attempt must return a plan');

    await planner(
      {
        ...input,
        retry: {
          attempt: 1,
          previous: first.value,
          diagnostics: overflowDiagnostics,
        },
      },
      ctx,
    );

    const retry = chatCall(1);
    expect(retry.systemPrompts).toEqual([buildReplylessSystemPrompt(mode)]);
    expect(retry.outputSchema).toEqual(
      convertOutputSchema(skipReplyOutputSchemaFor(mode)),
    );
    expect(retry.messages).toEqual([
      {
        role: 'user',
        content: buildRetryPrompt(
          buildUserPrompt(request),
          overflowDiagnostics,
        ),
      },
    ]);
    expect(retry.messages[0]?.content).not.toContain('userMessage');
  });

  test('llmPlanner ignores skipReply and sends the default prompt and schema', async () => {
    mockChat.mockResolvedValueOnce(replyBearingOutputFor(mode));
    const input = makePlanningInput(withSkipReply(requestFor(mode), true));

    const result = await llmPlanner({ adapter: dummyAdapter })(
      input,
      makeStageContext({ origin: input }),
    );

    expect(isOk(result)).toBe(true);
    expect(chatCall(0).systemPrompts).toEqual([buildSystemPrompt(mode)]);
    expect(chatCall(0).outputSchema).toEqual(
      convertOutputSchema(
        mode === 'grid' ? GridModelOutputSchema : TilingModelOutputSchema,
      ),
    );
  });

  test('system prompt customizers reach the reply-free prompt', async () => {
    mockChat.mockResolvedValueOnce(replylessOutputs[mode]);
    const prompt: PromptOptions = {
      vars: { assistantName: 'Aria' },
      system: { rules: (defaults) => `${defaults}\n\nSENTINEL_RULES` },
    };
    const input = makePlanningInput(withSkipReply(requestFor(mode), true));

    await clarifyingLlmPlanner({ adapter: dummyAdapter, prompt })(
      input,
      makeStageContext({ origin: input }),
    );

    expect(chatCall(0).systemPrompts).toEqual([
      buildReplylessSystemPrompt(mode, prompt),
    ]);
    expect(chatCall(0).systemPrompts[0]).toContain('You are Aria,');
    expect(chatCall(0).systemPrompts[0]).toContain('SENTINEL_RULES');
  });
});

describe('clarifyingLlmPlanner construction', () => {
  test('builds the default and reply-free system prompts for both modes once', () => {
    let customizerCalls = 0;
    clarifyingLlmPlanner({
      adapter: dummyAdapter,
      prompt: {
        system: {
          rules: (defaults) => {
            customizerCalls += 1;
            return defaults;
          },
        },
      },
    });

    expect(customizerCalls).toBe(4);
  });

  test('a customizer that breaks only the reply-free prompt throws at construction', () => {
    const prompt: PromptOptions = {
      system: {
        identity: (defaults) => {
          if (!defaults.includes('friendly')) throw new Error('identity boom');
          return defaults;
        },
      },
    };

    expect(() => llmPlanner({ adapter: dummyAdapter, prompt })).not.toThrow();
    expect(() =>
      clarifyingLlmPlanner({ adapter: dummyAdapter, prompt }),
    ).toThrow(/^Invalid LlmPlannerOptions: prompt\.system: .*identity/);
  });

  test('rejects invalid options like llmPlanner', () => {
    expect(() => clarifyingLlmPlanner({ adapter: undefined as never })).toThrow(
      /^Invalid LlmPlannerOptions:/,
    );
  });
});

function requestFor(mode: LayoutMode): ChartRequest {
  return mode === 'grid' ? makeGridRequest() : makeTilingRequest();
}

function withSkipReply(
  request: ChartRequest,
  skipReply: boolean | undefined,
): ChartRequest {
  return skipReply === undefined ? request : { ...request, skipReply };
}

function replyBearingOutputFor(mode: LayoutMode) {
  return mode === 'grid'
    ? buildGridResponse()
    : { userMessage: 'Split the screen.', ...replylessOutputs.tiling };
}

async function runWithSkipReply(mode: LayoutMode) {
  const input = makePlanningInput(withSkipReply(requestFor(mode), true));
  return clarifyingLlmPlanner({ adapter: dummyAdapter })(
    input,
    makeStageContext({ origin: input }),
  );
}

function chatCall(index: number): ChatArgs {
  const args = mockChat.mock.calls[index]?.[0] as ChatArgs | undefined;
  if (args === undefined) throw new Error(`no chat call at index ${index}`);
  return args;
}

function comparableChatCalls() {
  return mockChat.mock.calls.map((call) => {
    const {
      abortController: _ignored,
      middleware: _middleware,
      adapter,
      ...rest
    } = call[0] as ChatArgs;
    return {
      ...rest,
      adapter: { kind: adapter.kind, name: adapter.name, model: adapter.model },
    };
  });
}
