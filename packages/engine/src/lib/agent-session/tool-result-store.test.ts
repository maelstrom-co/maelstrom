import { describe, expect, test } from 'bun:test';

import { CallId, RunId } from '@maelstrom-co/protocol';

import type { AgentRunToolPhaseEndedEvent } from './agent-run.js';
import {
  createToolResultStore,
  TOOL_RESULT_STORE_CAPACITY,
  TOOL_RESULT_STORE_MAX_CHARS,
} from './tool-result-store.js';
import { toolCallRef } from './transcript.js';

const runId = RunId('run-1');

describe('createToolResultStore', () => {
  test('returns the full result of a successful call by its run-qualified ref', () => {
    const store = createToolResultStore();
    const value = { orderId: 'order-42', lines: ['line item'] };
    store.recordToolPhase(runId, {
      type: 'tool_phase_ended',
      turnId: 'run-1:t1',
      results: [
        {
          callId: CallId('c1'),
          name: 'latest_order',
          ok: true,
          summary: 'Found order order-42',
          value,
        },
      ],
    });

    expect(store.get(toolCallRef(runId, CallId('c1')))).toEqual({
      callId: CallId('c1'),
      name: 'latest_order',
      ok: true,
      summary: 'Found order order-42',
      value,
    });
    expect(
      store.get(toolCallRef(RunId('run-2'), CallId('c1'))),
    ).toBeUndefined();
  });

  test('does not keep failed results', () => {
    const store = createToolResultStore();
    store.recordToolPhase(runId, {
      type: 'tool_phase_ended',
      turnId: 'run-1:t1',
      results: [
        {
          callId: CallId('c1'),
          name: 'latest_order',
          ok: false,
          summary: 'latest_order failed',
        },
      ],
    });

    expect(store.get(toolCallRef(runId, CallId('c1')))).toBeUndefined();
  });

  test('keeps the 256 most recent results and evicts the oldest at 257', () => {
    const store = createToolResultStore();
    const total = TOOL_RESULT_STORE_CAPACITY + 1;
    for (let index = 1; index <= total; index += 1) {
      store.recordToolPhase(runId, successfulPhase(`c${index}`, index));
    }

    expect(TOOL_RESULT_STORE_CAPACITY).toBe(256);
    expect(store.get(toolCallRef(runId, CallId('c1')))).toBeUndefined();
    expect(store.get(toolCallRef(runId, CallId('c2')))?.value).toBe(2);
    expect(store.get(toolCallRef(runId, CallId(`c${total}`)))?.value).toBe(
      total,
    );
  });

  test('evicts the oldest results until the serialized values fit the character budget', () => {
    const store = createToolResultStore({ maxChars: 25 });
    store.recordToolPhase(runId, successfulPhase('c1', 'a'.repeat(8)));
    store.recordToolPhase(runId, successfulPhase('c2', 'b'.repeat(8)));
    store.recordToolPhase(runId, successfulPhase('c3', 'c'.repeat(8)));

    expect(store.get(toolCallRef(runId, CallId('c1')))).toBeUndefined();
    expect(store.get(toolCallRef(runId, CallId('c2')))?.value).toBe(
      'b'.repeat(8),
    );
    expect(store.get(toolCallRef(runId, CallId('c3')))?.value).toBe(
      'c'.repeat(8),
    );
  });

  test('does not keep a result whose value alone exceeds the character budget', () => {
    const store = createToolResultStore({ maxChars: 25 });
    store.recordToolPhase(runId, successfulPhase('c1', 'a'.repeat(8)));
    store.recordToolPhase(runId, successfulPhase('c2', 'b'.repeat(30)));

    expect(store.get(toolCallRef(runId, CallId('c1')))?.value).toBe(
      'a'.repeat(8),
    );
    expect(store.get(toolCallRef(runId, CallId('c2')))).toBeUndefined();
  });

  test('counts a re-recorded call once against the character budget', () => {
    const store = createToolResultStore({ maxChars: 25 });
    store.recordToolPhase(runId, successfulPhase('c1', 'a'.repeat(8)));
    store.recordToolPhase(runId, successfulPhase('c2', 'b'.repeat(8)));
    store.recordToolPhase(runId, successfulPhase('c2', 'b'.repeat(8)));

    expect(store.get(toolCallRef(runId, CallId('c1')))?.value).toBe(
      'a'.repeat(8),
    );
  });

  test('does not keep a result whose value cannot be serialized', () => {
    const store = createToolResultStore();
    store.recordToolPhase(runId, successfulPhase('c1', 1n));

    expect(store.get(toolCallRef(runId, CallId('c1')))).toBeUndefined();
  });

  test('bounds retained values at 256,000 serialized characters by default', () => {
    expect(TOOL_RESULT_STORE_MAX_CHARS).toBe(256_000);
  });
});

function successfulPhase(
  callId: string,
  value: unknown,
): AgentRunToolPhaseEndedEvent {
  return {
    type: 'tool_phase_ended',
    turnId: `run-1:${callId}`,
    results: [
      {
        callId: CallId(callId),
        name: 'latest_order',
        ok: true,
        summary: `Result ${callId}`,
        value,
      },
    ],
  };
}
