import { describe, expect, it, mock } from 'bun:test';

import type {
  CapabilitySnapshot,
  UIStructuralSnapshot,
} from '@maelstrom-co/client';
import { ok, SessionId, ToolCallId } from '@maelstrom-co/protocol';

import { RealtimeVoiceError } from '../realtime-voice-error.js';
import type {
  AdapterInputControl,
  AdapterTurnControl,
  AdapterVoiceObservation,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  ToolResult,
} from './provider-adapter.types.js';
import { RealtimeSession } from './realtime-session.js';
import type {
  RealtimeInstance,
  SubmitIntentResult,
} from './realtime-session.types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const EMPTY_SNAPSHOT: UIStructuralSnapshot = {
  instances: [],
  layoutMode: 'grid',
  layout: { type: 'grid', positions: [] },
  chartDimensions: { rows: 8, columns: 12 },
};

const EMPTY_CAPABILITIES: CapabilitySnapshot = {
  vessels: [],
};

function makeHarness(
  options: {
    submitIntent?: (intent: string) => Promise<SubmitIntentResult>;
    turnControl?: AdapterTurnControl;
    omitInputControl?: boolean;
    setInputEnabled?: (enabled: boolean) => void | Promise<void>;
    disconnect?: () => Promise<void>;
  } = {},
) {
  const eventHandlers = new Set<(event: RealtimeAdapterEvent) => void>();
  const observationHandlers = new Set<
    (event: AdapterVoiceObservation) => void
  >();
  const toolResults: Array<{ callId: ToolCallId; output: ToolResult }> = [];
  const inputEnabledCalls: boolean[] = [];
  let connectCount = 0;
  let disconnectCount = 0;

  const inputControl: AdapterInputControl = {
    setInputEnabled(enabled: boolean) {
      inputEnabledCalls.push(enabled);
      for (const handler of observationHandlers) {
        handler({
          type: 'media',
          media: { microphone: enabled ? 'active' : 'inactive' },
        });
      }
      return options.setInputEnabled?.(enabled);
    },
  };

  const adapter: RealtimeProviderAdapter & {
    turnControl?: AdapterTurnControl;
    emit(event: RealtimeAdapterEvent): void;
  } = {
    observations: {
      subscribe(handler) {
        observationHandlers.add(handler);
        return () => {
          observationHandlers.delete(handler);
        };
      },
    },
    inputControl: options.omitInputControl ? undefined : inputControl,
    turnControl: options.turnControl,
    async connect() {
      connectCount += 1;
      for (const handler of observationHandlers) {
        handler({ type: 'media', media: { microphone: 'active' } });
      }
    },
    async disconnect() {
      disconnectCount += 1;
      await options.disconnect?.();
    },
    getAudioStreams: () => ({}),
    async sendToolResult(callId, output) {
      toolResults.push({ callId, output });
    },
    injectGrounding() {},
    on(handler) {
      eventHandlers.add(handler);
      return () => {
        eventHandlers.delete(handler);
      };
    },
    emit(event) {
      for (const handler of [...eventHandlers]) handler(event);
    },
  };

  const instance: RealtimeInstance = {
    submitIntent:
      options.submitIntent ?? (async () => ({ userMessage: 'Done.' })),
    waitForIdle: async () => {},
    waitForIdleResult: async () => ok(undefined),
    getStructuralSnapshot: () => EMPTY_SNAPSHOT,
    getCapabilitySnapshot: () => EMPTY_CAPABILITIES,
    onSettled: () => () => {},
    addAssistantMessageAcknowledged: async () => 'inserted',
    observeEngineConnection: (cb) => {
      cb(true);
      return () => {};
    },
  };

  const session = new RealtimeSession({
    adapter,
    instance,
    sessionId: SessionId('mute-test-session'),
  });

  return {
    session,
    adapter,
    toolResults,
    inputEnabledCalls,
    get connectCount() {
      return connectCount;
    },
    get disconnectCount() {
      return disconnectCount;
    },
  };
}

describe('RealtimeSession input mute', () => {
  it('mutes during a pending submit_intent while delivering its result, keeping mic inactive and epoch unchanged', async () => {
    const pending = deferred<SubmitIntentResult>();
    const h = makeHarness({
      submitIntent: () => pending.promise,
    });
    const muteEvents: boolean[] = [];
    h.session.on('input_muted', (muted) => muteEvents.push(muted));

    await h.session.connect();
    const generationBefore = h.session.observations.getSnapshot().generation;
    expect(h.session.observations.getSnapshot().media.microphone).toBe(
      'active',
    );

    const callId = ToolCallId('call-mid-task');
    h.adapter.emit({
      type: 'tool_call',
      callId,
      name: 'submit_intent',
      argumentsJson: JSON.stringify({ intent: 'filter tasks to Chris' }),
    });
    await flushMicrotasks();

    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(true);
    expect(muteEvents).toEqual([true]);
    expect(h.inputEnabledCalls).toEqual([false]);
    expect(h.session.observations.getSnapshot().media.microphone).toBe(
      'inactive',
    );
    expect(h.session.state).toBe('connected');
    expect(h.session.observations.getSnapshot().generation).toBe(
      generationBefore,
    );
    expect(h.disconnectCount).toBe(0);

    pending.resolve({ userMessage: 'Filtered tasks to Chris.' });
    await flushMicrotasks();

    expect(h.toolResults).toHaveLength(1);
    expect(h.toolResults[0]?.callId).toBe(callId);
    expect(h.toolResults[0]?.output).toMatchObject({
      ok: true,
      userMessage: 'Filtered tasks to Chris.',
    });

    h.session.setInputMuted(false);
    expect(h.session.inputMuted).toBe(false);
    expect(muteEvents).toEqual([true, false]);
    expect(h.inputEnabledCalls).toEqual([false, true]);
    expect(h.session.observations.getSnapshot().media.microphone).toBe(
      'active',
    );
    expect(h.connectCount).toBe(1);
    expect(h.disconnectCount).toBe(0);
  });

  it('makes manual startTurn a no-op while muted, survives turn-mode switches, and resets on disconnect', async () => {
    const startTurn = mock(async () => {});
    const endTurn = mock(async () => {});
    const h = makeHarness({
      turnControl: { startTurn, endTurn },
    });
    const muteEvents: boolean[] = [];
    h.session.on('input_muted', (muted) => muteEvents.push(muted));

    // No-op while disconnected.
    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(false);
    expect(h.inputEnabledCalls).toEqual([]);

    await h.session.connect();
    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(true);

    // Switch to manual mode: mute survives.
    h.adapter.emit({ type: 'turn_mode', mode: 'manual' });
    expect(h.session.turnMode).toBe('manual');
    expect(h.session.inputMuted).toBe(true);

    // startTurn is a no-op while muted; endTurn still forwards.
    await h.session.turnControl?.startTurn();
    expect(startTurn).not.toHaveBeenCalled();
    await h.session.turnControl?.endTurn();
    expect(endTurn).toHaveBeenCalledTimes(1);

    // Unmuting restores startTurn.
    h.session.setInputMuted(false);
    await h.session.turnControl?.startTurn();
    expect(startTurn).toHaveBeenCalledTimes(1);

    // Re-mute, switch back to automatic, then disconnect: mute resets.
    h.session.setInputMuted(true);
    h.adapter.emit({ type: 'turn_mode', mode: 'automatic' });
    expect(h.session.inputMuted).toBe(true);

    await h.session.disconnect();
    expect(h.session.inputMuted).toBe(false);
    expect(muteEvents).toEqual([true, false, true, false]);
  });

  it('keeps setTurnMode on the muted control so the mode can change while muted', async () => {
    const startTurn = mock(async () => {});
    const setTurnMode = mock(async () => {});
    const h = makeHarness({
      turnControl: { startTurn, endTurn: async () => {}, setTurnMode },
    });
    await h.session.connect();
    h.session.setInputMuted(true);

    expect(h.session.turnMode).toBe('automatic');
    await h.session.turnControl?.setTurnMode?.('manual');
    expect(setTurnMode).toHaveBeenCalledWith('manual');

    h.adapter.emit({ type: 'turn_mode', mode: 'manual' });
    await h.session.turnControl?.startTurn();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it('ignores a mute request when the adapter cannot gate its microphone', async () => {
    const h = makeHarness({ omitInputControl: true });
    const observed: boolean[] = [];
    h.session.on('input_muted', (muted) => {
      observed.push(muted);
    });
    await h.session.connect();

    h.session.setInputMuted(true);

    expect(h.session.inputMuted).toBe(false);
    expect(observed).toEqual([]);
    expect(h.inputEnabledCalls).toEqual([]);
    expect(h.session.state).not.toBe('error');
    await h.session.disconnect();
  });

  it('returns to unmuted when the adapter rejects the mute, and a retry reaches the adapter again', async () => {
    let rejectNext = true;
    const h = makeHarness({
      setInputEnabled: (enabled) => {
        if (!enabled && rejectNext) {
          rejectNext = false;
          return Promise.reject(new Error('gate failed'));
        }
        return undefined;
      },
    });
    const observed: boolean[] = [];
    h.session.on('input_muted', (muted) => {
      observed.push(muted);
    });
    await h.session.connect();

    h.session.setInputMuted(true);
    await flushMicrotasks();
    expect(h.session.inputMuted).toBe(false);
    expect(observed).toEqual([true, false]);

    h.session.setInputMuted(true);
    await flushMicrotasks();
    expect(h.session.inputMuted).toBe(true);
    expect(h.inputEnabledCalls).toEqual([false, false]);
    expect(observed).toEqual([true, false, true]);
    await h.session.disconnect();
  });

  it('returns to unmuted when the adapter throws synchronously on mute', async () => {
    const h = makeHarness({
      setInputEnabled: (enabled) => {
        if (!enabled) throw new Error('gate failed');
      },
    });
    await h.session.connect();

    h.session.setInputMuted(true);

    expect(h.session.inputMuted).toBe(false);
    expect(h.session.state).not.toBe('error');
    await h.session.disconnect();
  });

  it('ignores a late mute rejection once a newer request replaced it', async () => {
    const first = deferred<void>();
    let rejectFirst!: (error: Error) => void;
    const firstFailure = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    let muteCalls = 0;
    const h = makeHarness({
      setInputEnabled: (enabled) => {
        if (enabled) return undefined;
        muteCalls += 1;
        return muteCalls === 1 ? firstFailure : first.promise;
      },
    });
    await h.session.connect();

    h.session.setInputMuted(true);
    h.session.setInputMuted(false);
    h.session.setInputMuted(true);
    rejectFirst(new Error('stale gate failure'));
    first.resolve();
    await flushMicrotasks();

    expect(h.session.inputMuted).toBe(true);
    await h.session.disconnect();
  });

  it('ignores mute requests while the connection is ending', async () => {
    const ending = deferred<void>();
    const h = makeHarness({ disconnect: () => ending.promise });
    await h.session.connect();
    h.session.setInputMuted(true);
    h.session.on('input_muted', (muted) => {
      if (!muted) h.session.setInputMuted(true);
    });

    const disconnecting = h.session.disconnect();
    expect(h.session.inputMuted).toBe(false);
    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(false);
    expect(h.inputEnabledCalls).toEqual([false]);

    ending.resolve();
    await disconnecting;
    expect(h.session.state).toBe('idle');
    expect(h.session.inputMuted).toBe(false);

    await h.session.connect();
    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(true);
    await h.session.disconnect();
  });

  it('resets mute on fatal adapter error', async () => {
    const h = makeHarness();
    await h.session.connect();
    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(true);

    h.adapter.emit({
      type: 'error',
      error: new RealtimeVoiceError('CONNECTION_FAILED', 'dropped'),
    });
    expect(h.session.state).toBe('error');
    expect(h.session.inputMuted).toBe(false);
  });

  it('gates adapter input before notifying subscribers and isolates a throwing subscriber', async () => {
    const h = makeHarness();
    await h.session.connect();
    const gateCallsAtNotify: boolean[][] = [];
    const later: boolean[] = [];
    h.session.on('input_muted', () => {
      gateCallsAtNotify.push([...h.inputEnabledCalls]);
      throw new Error('subscriber failed');
    });
    h.session.on('input_muted', (muted) => later.push(muted));

    expect(() => h.session.setInputMuted(true)).not.toThrow();

    expect(gateCallsAtNotify).toEqual([[false]]);
    expect(h.inputEnabledCalls).toEqual([false]);
    expect(h.session.inputMuted).toBe(true);
    expect(later).toEqual([true]);
  });

  it('keeps a re-entrant subscriber request as the final adapter gate state', async () => {
    const h = makeHarness();
    await h.session.connect();
    const later: boolean[] = [];
    h.session.on('input_muted', (muted) => {
      if (muted) h.session.setInputMuted(false);
    });
    h.session.on('input_muted', (muted) => later.push(muted));

    h.session.setInputMuted(true);

    expect(h.session.inputMuted).toBe(false);
    expect(h.inputEnabledCalls).toEqual([false, true]);
    expect(later).toEqual([false]);
  });
});
