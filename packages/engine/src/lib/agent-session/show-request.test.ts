import { describe, expect, test } from 'bun:test';

import {
  CallId,
  type ChartRequest,
  type JsonValue,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

import { invalid, makeGridRequest } from '../__test-helpers__/fixtures.js';
import type { Logger } from '../logger.js';
import type {
  AgentRunToolPhaseEndedEvent,
  AgentRunToolPhaseResult,
} from './agent-run.js';
import { serverTool } from './server-tool.js';
import {
  buildShowRequest,
  collectShowFacts,
  SHOW_FACTS_MAX_CHARS,
} from './show-request.js';
import { createToolRegistry, type ToolRegistry } from './tool-registry.js';

const SECRET_OUTPUT = 'secret-output-ORD-99999';
const SECRET_ERROR = 'extractor exploded with a secret';

describe('collectShowFacts', () => {
  test('keys each call facts by tool name and call id in call order', () => {
    const { logger } = recordingLogger();
    const show = collectShowFacts(
      phase([
        success('c1', 'latest_order', { orderId: 'ORD-10455' }),
        success('c2', 'search_products', { skus: ['SKU-1'] }),
        success('c3', 'latest_order', { orderId: 'ORD-10456' }),
      ]),
      registry(),
      logger,
    );

    expect(show?.toolNames).toEqual([
      'latest_order',
      'search_products',
      'latest_order',
    ]);
    expect(show?.intentFacts).toEqual({
      'latest_order:c1': { orderId: 'ORD-10455' },
      'search_products:c2': { skus: ['SKU-1'] },
      'latest_order:c3': { orderId: 'ORD-10456' },
    });
    expect(Object.keys(show?.intentFacts ?? {})).toEqual([
      'latest_order:c1',
      'search_products:c2',
      'latest_order:c3',
    ]);
  });

  test('a failed result contributes no tool name and no facts', () => {
    const { logger } = recordingLogger();
    const show = collectShowFacts(
      phase([
        failure('c1', 'latest_order'),
        success('c2', 'search_products', { skus: ['SKU-1'] }),
      ]),
      registry(),
      logger,
    );

    expect(show).toEqual({
      toolNames: ['search_products'],
      intentFacts: { 'search_products:c2': { skus: ['SKU-1'] } },
    });
  });

  test('a phase with only failed results asks for no show', () => {
    const { logger } = recordingLogger();
    expect(
      collectShowFacts(
        phase([
          failure('c1', 'latest_order'),
          failure('c2', 'search_products'),
        ]),
        registry(),
        logger,
      ),
    ).toBeUndefined();
  });

  test('a phase where no tool declares facts still asks for a show without facts', () => {
    const { logger, warnings } = recordingLogger();
    const show = collectShowFacts(
      phase([success('c1', 'plain', { text: 'hi' })]),
      registry(),
      logger,
    );

    expect(show).toEqual({ toolNames: ['plain'] });
    expect(show).not.toHaveProperty('intentFacts');
    expect(warnings).toEqual([]);
  });

  test('a successful call without an extractor is listed beside calls with facts', () => {
    const { logger } = recordingLogger();
    const show = collectShowFacts(
      phase([
        success('c1', 'plain', { text: 'hi' }),
        success('c2', 'latest_order', { orderId: 'ORD-10455' }),
      ]),
      registry(),
      logger,
    );

    expect(show).toEqual({
      toolNames: ['plain', 'latest_order'],
      intentFacts: { 'latest_order:c2': { orderId: 'ORD-10455' } },
    });
  });

  test('a throwing extractor drops that call facts and logs only the tool name', () => {
    const { logger, warnings } = recordingLogger();
    const show = collectShowFacts(
      phase([
        success('c1', 'throwing', { text: SECRET_OUTPUT }),
        success('c2', 'latest_order', { orderId: 'ORD-10455' }),
      ]),
      registry(),
      logger,
    );

    expect(show).toEqual({
      toolNames: ['throwing', 'latest_order'],
      intentFacts: { 'latest_order:c2': { orderId: 'ORD-10455' } },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.data).toEqual({ toolName: 'throwing' });
    const logged = JSON.stringify(warnings);
    expect(logged).not.toContain(SECRET_OUTPUT);
    expect(logged).not.toContain(SECRET_ERROR);
  });

  test.each([
    ['an array', ['ORD-10455']],
    ['a string', 'ORD-10455'],
    ['null', null],
    ['a date', new Date(0)],
  ])('an extractor returning %s drops that call facts', (_label, facts) => {
    const { logger, warnings } = recordingLogger();
    const show = collectShowFacts(
      phase([success('c1', 'returning', { text: SECRET_OUTPUT })]),
      registry(facts),
      logger,
    );

    expect(show).toEqual({ toolNames: ['returning'] });
    expect(warnings.map((warning) => warning.data)).toEqual([
      { toolName: 'returning' },
    ]);
    expect(JSON.stringify(warnings)).not.toContain(SECRET_OUTPUT);
  });

  test.each([
    ['undefined', { orderId: undefined }],
    ['a function', { orderId: () => 'ORD-10455' }],
    ['a bigint', { total: 1n }],
    ['a non-finite number', { total: Number.POSITIVE_INFINITY }],
    ['a nested date', { placedOn: new Date(0) }],
  ])(
    'an extractor returning an object holding %s drops that call facts',
    (_label, facts) => {
      const { logger, warnings } = recordingLogger();
      const show = collectShowFacts(
        phase([success('c1', 'returning', { text: 'hi' })]),
        registry(facts),
        logger,
      );

      expect(show).toEqual({ toolNames: ['returning'] });
      expect(warnings.map((warning) => warning.data)).toEqual([
        { toolName: 'returning' },
      ]);
    },
  );

  test.each([
    ['a self-referencing object', selfReferencingFacts()],
    ['an object with a throwing getter', throwingGetterFacts()],
  ])(
    'an extractor returning %s drops that call facts without throwing',
    (_label, facts) => {
      const { logger, warnings } = recordingLogger();
      const show = collectShowFacts(
        phase([
          success('c1', 'returning', { text: SECRET_OUTPUT }),
          success('c2', 'latest_order', { orderId: 'ORD-10455' }),
        ]),
        registry(facts),
        logger,
      );

      expect(show).toEqual({
        toolNames: ['returning', 'latest_order'],
        intentFacts: { 'latest_order:c2': { orderId: 'ORD-10455' } },
      });
      expect(warnings.map((warning) => warning.data)).toEqual([
        { toolName: 'returning' },
      ]);
      const logged = JSON.stringify(warnings);
      expect(logged).not.toContain(SECRET_OUTPUT);
      expect(logged).not.toContain(SECRET_ERROR);
    },
  );

  test('an extractor returning an empty object adds no facts', () => {
    const { logger, warnings } = recordingLogger();
    const show = collectShowFacts(
      phase([success('c1', 'returning', { text: 'hi' })]),
      registry({}),
      logger,
    );

    expect(show).toEqual({ toolNames: ['returning'] });
    expect(warnings).toEqual([]);
  });

  test('caps serialized facts at 8,000 characters', () => {
    expect(SHOW_FACTS_MAX_CHARS).toBe(8_000);
  });

  test('keeps facts that serialize to exactly the cap', () => {
    const { logger, warnings } = recordingLogger();
    const text = 'a'.repeat(
      SHOW_FACTS_MAX_CHARS - '{"echo:c1":{"text":""}}'.length,
    );
    const show = collectShowFacts(
      phase([success('c1', 'echo', { text })]),
      registry(),
      logger,
    );

    expect(JSON.stringify(show?.intentFacts)).toHaveLength(
      SHOW_FACTS_MAX_CHARS,
    );
    expect(warnings).toEqual([]);
  });

  test('drops the call that crosses the cap and every later call facts with one warning', () => {
    const { logger, warnings } = recordingLogger();
    const show = collectShowFacts(
      phase([
        success('c1', 'echo', { text: 'a'.repeat(3_000) }),
        success('c2', 'latest_order', { orderId: 'ORD-10455' }),
        success('c3', 'echo', { text: 'b'.repeat(5_000) }),
        success('c4', 'latest_order', { orderId: 'ORD-10456' }),
      ]),
      registry(),
      logger,
    );

    expect(show?.toolNames).toEqual([
      'echo',
      'latest_order',
      'echo',
      'latest_order',
    ]);
    expect(show?.intentFacts).toEqual({
      'echo:c1': { text: 'a'.repeat(3_000) },
      'latest_order:c2': { orderId: 'ORD-10455' },
    });
    expect(warnings.map((warning) => warning.data)).toEqual([
      { toolNames: ['echo', 'latest_order'], maxChars: SHOW_FACTS_MAX_CHARS },
    ]);
    expect(JSON.stringify(warnings)).not.toContain('bbbb');
  });

  test('a single call over the cap leaves the show without facts', () => {
    const { logger } = recordingLogger();
    const show = collectShowFacts(
      phase([
        success('c1', 'echo', { text: 'a'.repeat(SHOW_FACTS_MAX_CHARS) }),
      ]),
      registry(),
      logger,
    );

    expect(show).toEqual({ toolNames: ['echo'] });
  });
});

describe('buildShowRequest', () => {
  test('replaces client skipReply and intentFacts and states the intent as the only reason', () => {
    const chart: ChartRequest = {
      ...makeGridRequest(),
      context: {
        ...makeGridRequest().context,
        updateReasons: [
          { type: 'user_intent', intent: 'old intent' },
          { type: 'user_intent', intent: 'another old intent' },
        ],
      },
      skipReply: false,
      intentFacts: { client: 'supplied' },
    };
    const facts = { 'latest_order:c1': { orderId: 'ORD-10455' } };

    const request = buildShowRequest(chart, 'show my latest order', facts);

    expect(request).toEqual({
      ...makeGridRequest(),
      skipReply: true,
      intentFacts: facts,
      context: {
        ...chart.context,
        updateReasons: [
          { type: 'user_intent', intent: 'show my latest order' },
        ],
      },
    });
  });

  test('omits intentFacts when the show has none, even when the client sent some', () => {
    const chart: ChartRequest = {
      ...makeGridRequest(),
      intentFacts: { client: 'supplied' },
    };

    const request = buildShowRequest(chart, 'show my latest order');

    expect(request).not.toHaveProperty('intentFacts');
    expect(request.skipReply).toBe(true);
    expect(request.context.updateReasons).toEqual([
      { type: 'user_intent', intent: 'show my latest order' },
    ]);
  });

  test('keeps the Chart snapshot fields unchanged', () => {
    const chart = makeGridRequest();

    const request = buildShowRequest(chart, 'show my latest order');

    expect(request.instances).toEqual(chart.instances);
    expect(request.vessels).toEqual(chart.vessels);
    expect(request.layout).toEqual(chart.layout);
    expect(request.context.chartDimensions).toEqual(
      chart.context.chartDimensions,
    );
    expect(request.context.layoutMode).toBe(chart.context.layoutMode);
  });
});

function phase(
  results: readonly AgentRunToolPhaseResult[],
): AgentRunToolPhaseEndedEvent {
  return { type: 'tool_phase_ended', turnId: 'run-1:t1', results };
}

function success(
  callId: string,
  name: string,
  value: unknown,
): AgentRunToolPhaseResult {
  return {
    callId: CallId(callId),
    name,
    ok: true,
    summary: `Result ${callId}`,
    value,
  };
}

function failure(callId: string, name: string): AgentRunToolPhaseResult {
  return {
    callId: CallId(callId),
    name,
    ok: false,
    summary: `Failed ${callId}`,
  };
}

function registry(returnedFacts?: unknown): ToolRegistry {
  const textOutput = z.object({ text: z.string() });
  const base = {
    description: 'Test tool',
    input: z.object({}),
    execute: async () => ({ text: '' }),
    summarize: (output: { text: string }) => output.text,
  };
  return createToolRegistry([
    serverTool({
      name: 'latest_order',
      description: 'Latest order',
      input: z.object({}),
      output: z.object({ orderId: z.string() }),
      execute: async () => ({ orderId: 'ORD-10455' }),
      summarize: (output) => output.orderId,
      intentFacts: (output) => ({ orderId: output.orderId }),
    }),
    serverTool({
      name: 'search_products',
      description: 'Search products',
      input: z.object({}),
      output: z.object({ skus: z.array(z.string()) }),
      execute: async () => ({ skus: [] }),
      summarize: (output) => output.skus.join(', '),
      intentFacts: (output) => ({ skus: output.skus }),
    }),
    serverTool({
      ...base,
      name: 'echo',
      output: textOutput,
      intentFacts: (output) => ({ text: output.text }),
    }),
    serverTool({ ...base, name: 'plain', output: textOutput }),
    serverTool({
      ...base,
      name: 'throwing',
      output: textOutput,
      intentFacts: () => {
        throw new Error(SECRET_ERROR);
      },
    }),
    serverTool({
      ...base,
      name: 'returning',
      output: textOutput,
      intentFacts: () =>
        invalid<Readonly<Record<string, JsonValue>>>(returnedFacts),
    }),
  ]);
}

function selfReferencingFacts(): Record<string, unknown> {
  const facts: Record<string, unknown> = { orderId: 'ORD-10455' };
  facts['self'] = facts;
  return facts;
}

function throwingGetterFacts(): Record<string, unknown> {
  return {
    get orderId(): string {
      throw new Error(SECRET_ERROR);
    },
  };
}

function recordingLogger(): {
  logger: Logger;
  warnings: { message: string; data?: Record<string, unknown> }[];
} {
  const warnings: { message: string; data?: Record<string, unknown> }[] = [];
  return {
    warnings,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (message, data) => {
        warnings.push({ message, data });
      },
      error: () => undefined,
    },
  };
}
