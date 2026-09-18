import { expect, test } from 'bun:test';
import type {
  AdapterVoiceActivation,
  VoiceActivationInput,
  VoiceInputAdmission,
} from '@maelstrom-co/realtime';
import FakeTimers from '@sinonjs/fake-timers';
import {
  TriggerInputLedger,
  TriggerResponseLedger,
} from './trigger-admission.js';

function responseHarness() {
  const sent: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  const busy = new Set<string>();
  const followUps: string[] = [];
  const activation: AdapterVoiceActivation = {
    version: 1,
    reportInput: () => {},
    admission: (id) => ({
      status: 'admitted',
      ancestry: { inputId: id, epoch: 1 },
    }),
    onChange: () => () => {},
    finishInput: () => {},
    beginActivity: (key) => {
      busy.add(key);
      return () => {
        busy.delete(key);
      };
    },
  };
  const ledger = new TriggerResponseLedger(activation, {
    send: (command) => {
      sent.push(command);
    },
    error: (error) => {
      errors.push(error);
    },
    changed: () => {},
    followUp: (id) => {
      followUps.push(id);
    },
  });
  ledger.admit({
    id: 'user',
    text: 'weather',
    ordinal: 1,
    ancestry: { inputId: 'user', epoch: 1 },
  });
  const dispatch = () => {
    const ids = ledger.input('user');
    expect(ids).toBeDefined();
    ledger.send({
      type: 'response.create',
      response: {
        conversation: 'auto',
        input: ids?.map((id) => ({ type: 'item_reference', id })),
      },
    });
    const command = sent.at(-1) as {
      response: { metadata: Record<string, string> };
    };
    return command.response.metadata;
  };
  const created = (id: string, metadata: Record<string, string>) =>
    ledger.observe({ type: 'response.created', response: { id, metadata } });
  return { ledger, sent, errors, busy, followUps, dispatch, created };
}

test('authenticates created responses by issued metadata, never just an outstanding request', () => {
  const h = responseHarness();
  try {
    const metadata = h.dispatch();
    expect(h.created('unsolicited', {})).toBe(false);
    expect(
      h.ledger.ancestry({ response_id: 'unsolicited', item_id: 'unknown' }),
    ).toBeUndefined();
    expect(h.created('owned', metadata)).toBe(true);
    expect(h.created('imposter', metadata)).toBe(false);
  } finally {
    h.ledger.close();
  }
});

test.each([
  'failed',
  'incomplete',
])('fails closed for a %s response even with empty output', (status) => {
  const h = responseHarness();
  try {
    h.created('response', h.dispatch());
    h.ledger.observe({
      type: 'response.done',
      response: { id: 'response', status, output: [] },
    });
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toMatchObject({
      code: 'ACTIVATION_ELIGIBILITY_FAILED',
    });
    expect(h.busy.size).toBe(0);
    expect(h.ledger.input('user')).toBeUndefined();
  } finally {
    h.ledger.close();
  }
});

test('defers queued responses while an owned call is still executing before result handoff', () => {
  const h = responseHarness();
  try {
    h.created('response', h.dispatch());
    const call = {
      id: 'call-item',
      type: 'function_call',
      call_id: 'call',
      name: 'get_ui_state',
      status: 'completed',
    };
    h.ledger.observe({
      type: 'response.output_item.added',
      response_id: 'response',
      output_index: 0,
      item: call,
    });
    h.ledger.toolAncestry({
      response_id: 'response',
      item_id: 'call-item',
      call_id: 'call',
      name: 'get_ui_state',
    });
    h.ledger.observe({
      type: 'response.done',
      response: { id: 'response', status: 'completed', output: [call] },
    });
    expect(h.ledger.input('user')).toBeUndefined();
  } finally {
    h.ledger.close();
  }
});

test('does not authorize outputs added after a response terminal', () => {
  const h = responseHarness();
  try {
    h.created('response', h.dispatch());
    h.ledger.observe({
      type: 'response.done',
      response: { id: 'response', status: 'completed', output: [] },
    });
    h.ledger.observe({
      type: 'response.output_item.added',
      response_id: 'response',
      output_index: 0,
      item: {
        id: 'late',
        type: 'message',
        role: 'assistant',
        status: 'completed',
      },
    });
    expect(h.errors).toHaveLength(1);
  } finally {
    h.ledger.close();
  }
});

test('keeps playback busy after generation until correlated output-buffer completion', () => {
  const h = responseHarness();
  try {
    h.created('response', h.dispatch());
    h.ledger.observe({
      type: 'response.output_item.added',
      response_id: 'response',
      output_index: 0,
      item: {
        id: 'assistant',
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
      },
    });
    const output = {
      id: 'assistant',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'audio', transcript: 'sunny' }],
    };
    h.ledger.observe({
      type: 'response.done',
      response: { id: 'response', status: 'completed', output: [output] },
    });
    expect(h.busy.size).toBe(1);
    h.ledger.observe({
      type: 'output_audio_buffer.stopped',
      response_id: 'unrelated',
    });
    expect(h.busy.size).toBe(1);
    h.ledger.observe({
      type: 'output_audio_buffer.started',
      response_id: 'response',
    });
    h.ledger.observe({
      type: 'output_audio_buffer.stopped',
      response_id: 'response',
    });
    expect(h.busy.size).toBe(0);
    expect(h.ledger.input('user')).toEqual(['user', 'assistant']);
  } finally {
    h.ledger.close();
  }
});

test('requires exact grounding acknowledgement and blocks snapshots during replacement', () => {
  const h = responseHarness();
  try {
    h.ledger.ground('first');
    expect(h.ledger.input('user')).toBeUndefined();
    const first = h.sent.at(-1) as {
      item: Record<string, unknown> & { id: string };
    };
    h.ledger.observe({ type: 'conversation.item.created', item: first.item });
    expect(h.ledger.input('user')).toEqual([first.item.id, 'user']);
    h.ledger.ground('second');
    expect(h.ledger.input('user')).toBeUndefined();
    h.ledger.observe({
      type: 'conversation.item.deleted',
      item_id: first.item.id,
    });
    const second = h.sent.at(-1) as { item: Record<string, unknown> };
    h.ledger.observe({
      type: 'conversation.item.created',
      item: {
        ...second.item,
        content: [{ type: 'input_text', text: 'wrong' }],
      },
    });
    expect(h.errors).toHaveLength(1);
  } finally {
    h.ledger.close();
  }
});

test('does not delete grounding referenced by an in-flight response snapshot', () => {
  const h = responseHarness();
  try {
    h.ledger.ground('first');
    const creation = h.sent.at(-1) as { item: Record<string, unknown> };
    h.ledger.observe({
      type: 'conversation.item.created',
      item: creation.item,
    });
    h.created('response', h.dispatch());
    h.ledger.ground('replacement');
    expect(
      h.sent.filter((event) => event.type === 'conversation.item.delete'),
    ).toEqual([]);
    h.ledger.observe({
      type: 'response.done',
      response: { id: 'response', status: 'completed', output: [] },
    });
    expect(h.sent.at(-1)).toEqual({
      type: 'conversation.item.delete',
      item_id: creation.item.id,
    });
  } finally {
    h.ledger.close();
  }
});

test('admits tool outputs only for owned calls and awaits the exact created acknowledgement', async () => {
  const h = responseHarness();
  try {
    h.created('response', h.dispatch());
    const call = {
      id: 'call-item',
      type: 'function_call',
      call_id: 'call',
      name: 'get_ui_state',
      arguments: '{}',
      status: 'completed',
    };
    h.ledger.observe({
      type: 'response.output_item.added',
      response_id: 'response',
      output_index: 0,
      item: call,
    });
    expect(
      h.ledger.toolAncestry({
        response_id: 'response',
        item_id: 'call-item',
        call_id: 'call',
        name: 'get_ui_state',
      }),
    ).toEqual({ inputId: 'user', epoch: 1 });
    h.ledger.observe({
      type: 'response.done',
      response: { id: 'response', status: 'completed', output: [call] },
    });
    const done = h.ledger.toolResult('call', { ok: true });
    expect(h.followUps).toEqual([]);
    expect(h.ledger.input('user')).toBeUndefined();
    const result = h.sent.at(-1) as {
      item: Record<string, unknown> & { id: string };
    };
    h.ledger.observe({ type: 'conversation.item.created', item: result.item });
    await done;
    expect(h.followUps).toEqual(['user']);
    expect(h.ledger.input('user')).toEqual([
      'user',
      'call-item',
      result.item.id,
    ]);
    expect(h.busy.size).toBeGreaterThan(0);
  } finally {
    h.ledger.close();
  }
});

test('interrupted audio cannot become a reference before truncation acknowledgement', () => {
  const h = responseHarness();
  try {
    h.created('response', h.dispatch());
    const item = {
      id: 'assistant',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'audio' }],
    };
    h.ledger.observe({
      type: 'response.output_item.added',
      response_id: 'response',
      output_index: 0,
      item,
    });
    h.ledger.send({ type: 'response.cancel', response_id: 'response' });
    h.ledger.observe({
      type: 'response.done',
      response: { id: 'response', status: 'cancelled', output: [item] },
    });
    expect(h.ledger.input('user')).toBeUndefined();
    h.ledger.observe({
      type: 'conversation.item.truncated',
      item_id: 'assistant',
      audio_end_ms: 100,
      content_index: 0,
    });
    expect(h.ledger.input('user')).toEqual(['user', 'assistant']);
  } finally {
    h.ledger.close();
  }
});

test('retains confirmed truncation when cancellation and clear straddle the acknowledgement', () => {
  const h = responseHarness();
  try {
    h.created('response', h.dispatch());
    const item = {
      id: 'assistant',
      type: 'message',
      role: 'assistant',
      status: 'incomplete',
      content: [{ type: 'audio' }],
    };
    h.ledger.observe({
      type: 'response.output_item.added',
      response_id: 'response',
      output_index: 0,
      item,
    });
    h.ledger.send({ type: 'response.cancel', response_id: 'response' });
    h.ledger.observe({
      type: 'conversation.item.truncated',
      item_id: 'assistant',
      audio_end_ms: 10,
      content_index: 0,
    });
    h.ledger.send({ type: 'output_audio_buffer.clear' });
    h.ledger.observe({
      type: 'response.done',
      response: { id: 'response', status: 'cancelled', output: [item] },
    });
    expect(h.ledger.input('user')).toEqual(['user', 'assistant']);
  } finally {
    h.ledger.close();
  }
});

test('deletion removes a reference and late output metadata cannot resurrect it', () => {
  const h = responseHarness();
  try {
    h.created('response', h.dispatch());
    const item = {
      id: 'assistant',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'text', text: 'hello' }],
    };
    h.ledger.observe({
      type: 'response.done',
      response: { id: 'response', status: 'completed', output: [item] },
    });
    h.ledger.observe({
      type: 'conversation.item.deleted',
      item_id: 'assistant',
    });
    expect(h.ledger.input('user')).toEqual(['user']);
    h.ledger.observe({
      type: 'response.output_item.done',
      response_id: 'response',
      output_index: 0,
      item,
    });
    expect(h.errors).toHaveLength(1);
  } finally {
    h.ledger.close();
  }
});

test.each([
  'mismatch',
  'timeout',
] as const)('fails an owned tool result on acknowledgement %s without a follow-up', async (failure) => {
  const clock = FakeTimers.install();
  const h = responseHarness();
  try {
    h.created('response', h.dispatch());
    const item = {
      id: 'call-item',
      type: 'function_call',
      call_id: 'call',
      name: 'get_ui_state',
      status: 'completed',
    };
    h.ledger.observe({
      type: 'response.output_item.added',
      response_id: 'response',
      output_index: 0,
      item,
    });
    h.ledger.toolAncestry({
      response_id: 'response',
      item_id: 'call-item',
      call_id: 'call',
      name: 'get_ui_state',
    });
    const pending = h.ledger.toolResult('call', { ok: true });
    void pending.catch(() => {});
    const output = h.sent.at(-1) as { item: Record<string, unknown> };
    if (failure === 'mismatch')
      h.ledger.observe({
        type: 'conversation.item.created',
        item: { ...output.item, call_id: 'wrong' },
      });
    else clock.tick(10000);
    await expect(pending).rejects.toMatchObject({
      code: 'ACTIVATION_ELIGIBILITY_FAILED',
    });
    expect(h.followUps).toEqual([]);
    expect(h.errors).toHaveLength(1);
    expect(h.busy.size).toBe(0);
  } finally {
    h.ledger.close();
    clock.uninstall();
  }
});

test('provider reference errors fail closed without a default-history retry', () => {
  const h = responseHarness();
  try {
    h.dispatch();
    h.ledger.observe({
      type: 'error',
      error: { code: 'invalid_request_error', message: 'missing item' },
    });
    expect(h.errors).toHaveLength(1);
    expect(h.ledger.input('user')).toBeUndefined();
    expect(h.sent).toHaveLength(1);
  } finally {
    h.ledger.close();
  }
});

test('missing created-response acknowledgement fails at its own fixed deadline', () => {
  const clock = FakeTimers.install();
  const h = responseHarness();
  try {
    h.dispatch();
    clock.tick(10000);
    expect(h.errors).toHaveLength(1);
    expect(h.busy.size).toBe(0);
  } finally {
    h.ledger.close();
    clock.uninstall();
  }
});

function harness() {
  const reports = new Map<string, VoiceActivationInput>();
  const admissions = new Map<string, VoiceInputAdmission>();
  const released: string[] = [];
  const finished: string[] = [];
  const errors: unknown[] = [];
  let changed = () => {};
  let ready = true;
  const activation: AdapterVoiceActivation = {
    version: 1,
    reportInput: (input) => {
      reports.set(input.id, input);
    },
    admission: (id) => admissions.get(id) ?? { status: 'pending' },
    onChange: (handler) => {
      changed = handler;
      return () => {
        changed = () => {};
      };
    },
    finishInput: (id) => {
      finished.push(id);
    },
    beginActivity: () => () => {},
  };
  const ledger = new TriggerInputLedger(activation, {
    release: (input) => {
      if (!ready) return false;
      expect(finished).not.toContain(input.id);
      released.push(input.id);
      return true;
    },
    error: (error) => {
      errors.push(error);
    },
  });
  const admit = (id: string) => {
    admissions.set(id, {
      status: 'admitted',
      ancestry: { inputId: id, epoch: 1 },
    });
    changed();
  };
  const source = (
    id: string,
    previous: string | null,
    start: number,
    end: number,
  ) => {
    ledger.observe({
      type: 'input_audio_buffer.speech_started',
      item_id: id,
      audio_start_ms: start,
    });
    ledger.observe({
      type: 'input_audio_buffer.speech_stopped',
      item_id: id,
      audio_end_ms: end,
    });
    ledger.observe({
      type: 'input_audio_buffer.committed',
      item_id: id,
      previous_item_id: previous,
    });
    ledger.observe({
      type: 'conversation.item.created',
      previous_item_id: previous,
      item: { id, type: 'message', role: 'user' },
    });
  };
  const final = (id: string, transcript: string) =>
    ledger.observe({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: id,
      transcript,
    });
  return {
    ledger,
    reports,
    admissions,
    released,
    finished,
    errors,
    admit,
    source,
    final,
    changed: () => changed(),
    setReady: (value: boolean) => {
      ready = value;
    },
  };
}

test('assigns contiguous source ordinals through predecessors, not final arrival', () => {
  const h = harness();
  try {
    h.final('request', 'show weather');
    h.source('request', 'trigger', 200, 300);
    expect(h.reports.get('request')?.ordinal).toBeUndefined();
    h.source('trigger', null, 0, 100);
    h.final('trigger', 'hello maelstrom');
    expect(h.reports.get('trigger')?.ordinal).toBe(1);
    expect(h.reports.get('request')?.ordinal).toBe(2);
    expect(h.released).toEqual([]);
    h.admissions.set('trigger', { status: 'excluded' });
    h.admit('request');
    expect(h.released).toEqual(['request']);
    expect(h.finished).toEqual(['request']);
    h.changed();
    expect(h.released).toHaveLength(1);
  } finally {
    h.ledger.close();
  }
});

test('keeps held finals private and defers reference transfer until created acknowledgement', () => {
  const h = harness();
  try {
    h.ledger.observe({
      type: 'input_audio_buffer.speech_started',
      item_id: 'user',
      audio_start_ms: 0,
    });
    h.ledger.observe({
      type: 'input_audio_buffer.speech_stopped',
      item_id: 'user',
      audio_end_ms: 100,
    });
    h.ledger.observe({
      type: 'input_audio_buffer.committed',
      item_id: 'user',
      previous_item_id: null,
    });
    h.final('user', 'weather');
    h.admissions.set('user', { status: 'held' });
    h.changed();
    h.admit('user');
    expect(h.released).toEqual([]);
    h.ledger.observe({
      type: 'conversation.item.created',
      previous_item_id: null,
      item: { id: 'user', type: 'message', role: 'user' },
    });
    expect(h.released).toEqual(['user']);
  } finally {
    h.ledger.close();
  }
});

test('waits for earlier admitted reference readiness instead of reordering release', () => {
  const h = harness();
  try {
    h.source('first', null, 0, 100);
    h.source('second', 'first', 100, 200);
    h.final('second', 'second');
    h.final('first', 'first');
    h.setReady(false);
    h.admit('first');
    h.admit('second');
    expect(h.finished).toEqual([]);
    h.setReady(true);
    h.ledger.referencesChanged();
    expect(h.released).toEqual(['first', 'second']);
  } finally {
    h.ledger.close();
  }
});

test('walks acknowledged nonaudio predecessors without assigning them speech ordinals', () => {
  const h = harness();
  try {
    h.source('first', null, 0, 100);
    h.ledger.observe({
      type: 'conversation.item.created',
      previous_item_id: 'first',
      item: { id: 'assistant', type: 'message', role: 'assistant' },
    });
    h.source('second', 'assistant', 200, 300);
    expect(h.reports.get('second')?.ordinal).toBe(2);
  } finally {
    h.ledger.close();
  }
});

test('retains end metadata arriving before start without forwarding an invalid bridge interval', () => {
  const h = harness();
  try {
    h.ledger.observe({
      type: 'input_audio_buffer.speech_stopped',
      item_id: 'user',
      audio_end_ms: 100,
    });
    expect(h.reports.get('user')?.end).toBeUndefined();
    h.ledger.observe({
      type: 'input_audio_buffer.speech_started',
      item_id: 'user',
      audio_start_ms: 10,
    });
    expect(h.reports.get('user')?.end).toBe(100);
  } finally {
    h.ledger.close();
  }
});

test('conflicting predecessors, ordinals, and intervals fail closed', () => {
  for (const conflict of ['predecessor', 'ordinal', 'interval'] as const) {
    const h = harness();
    try {
      h.source('first', null, 0, 100);
      if (conflict === 'predecessor')
        h.ledger.observe({
          type: 'input_audio_buffer.committed',
          item_id: 'first',
          previous_item_id: 'unknown',
        });
      if (conflict === 'ordinal') h.source('second', null, 200, 300);
      if (conflict === 'interval')
        h.ledger.observe({
          type: 'input_audio_buffer.speech_started',
          item_id: 'first',
          audio_start_ms: 50,
        });
      expect(h.errors).toHaveLength(1);
      h.final('first', 'hello maelstrom');
      h.admit('first');
      expect(h.released).toEqual([]);
    } finally {
      h.ledger.close();
    }
  }
});

test('bounds unresolved ownership without extending the deadline on updates', () => {
  const clock = FakeTimers.install();
  const h = harness();
  try {
    h.final('unknown', 'hello maelstrom');
    clock.tick(9999);
    h.ledger.observe({
      type: 'input_audio_buffer.committed',
      item_id: 'unknown',
      previous_item_id: 'missing',
    });
    clock.tick(1);
    expect(h.errors).toHaveLength(1);
    h.source('unknown', null, 0, 100);
    h.admit('unknown');
    expect(h.released).toEqual([]);
  } finally {
    h.ledger.close();
    clock.uninstall();
  }
});

test('enforces private terminal text and pending record ceilings', () => {
  for (const limit of ['text', 'records'] as const) {
    const h = harness();
    try {
      if (limit === 'text') h.final('user', 'é'.repeat(131073));
      else for (let i = 0; i < 129; i++) h.final(`user-${i}`, 'pending');
      expect(h.errors).toHaveLength(1);
      expect(h.released).toEqual([]);
    } finally {
      h.ledger.close();
    }
  }
});

test('empty/error terminals and disconnect never release text or stale callbacks', () => {
  const h = harness();
  h.source('empty', null, 0, 100);
  h.final('empty', ' ');
  h.source('failed', 'empty', 200, 300);
  h.ledger.observe({
    type: 'conversation.item.input_audio_transcription.failed',
    item_id: 'failed',
  });
  expect(h.reports.get('empty')?.outcome).toBe('empty');
  expect(h.reports.get('failed')?.outcome).toBe('error');
  h.admit('empty');
  h.admit('failed');
  h.ledger.close();
  h.source('late', 'failed', 400, 500);
  h.final('late', 'hello maelstrom');
  h.admit('late');
  expect(h.released).toEqual([]);
});

test('does not skip an audio predecessor merely because its created event arrived first', () => {
  const h = harness();
  try {
    h.ledger.observe({
      type: 'conversation.item.created',
      previous_item_id: null,
      item: { id: 'first', type: 'message', role: 'user' },
    });
    h.source('second', 'first', 200, 300);
    expect(h.reports.get('second')?.ordinal).toBeUndefined();
    h.source('first', null, 0, 100);
    expect(h.reports.get('second')?.ordinal).toBe(2);
  } finally {
    h.ledger.close();
  }
});

test('continues reporting terminal evidence for a continuing excluded source', () => {
  const h = harness();
  try {
    h.ledger.observe({
      type: 'input_audio_buffer.speech_started',
      item_id: 'excluded',
      audio_start_ms: 0,
    });
    h.ledger.observe({
      type: 'input_audio_buffer.committed',
      item_id: 'excluded',
      previous_item_id: null,
    });
    h.admissions.set('excluded', { status: 'excluded' });
    h.changed();
    h.ledger.observe({
      type: 'input_audio_buffer.speech_stopped',
      item_id: 'excluded',
      audio_end_ms: 100,
    });
    h.final('excluded', 'ignored');
    expect(h.reports.get('excluded')?.outcome).toBe('success');
    expect(h.reports.get('excluded')?.end).toBe(100);
    expect(h.released).toEqual([]);
  } finally {
    h.ledger.close();
  }
});

test('cycles and predecessor/audio-start inversions fail closed', () => {
  for (const cycle of [true, false]) {
    const h = harness();
    try {
      h.source('first', cycle ? 'second' : null, 200, 300);
      h.source('second', 'first', 0, 100);
      expect(h.errors).toHaveLength(1);
    } finally {
      h.ledger.close();
    }
  }
});

test('does not accept malformed created-item acknowledgements as audio readiness', () => {
  const h = harness();
  try {
    h.ledger.observe({
      type: 'input_audio_buffer.speech_started',
      item_id: 'user',
      audio_start_ms: 0,
    });
    h.ledger.observe({
      type: 'conversation.item.created',
      previous_item_id: null,
      item: { id: 'user', type: 'unknown' },
    });
    expect(h.errors).toHaveLength(1);
  } finally {
    h.ledger.close();
  }
});
