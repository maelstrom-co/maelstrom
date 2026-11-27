import { describe, expect, it, mock } from 'bun:test';

import { RealtimeVoiceError } from '../realtime-voice-error.js';
import {
  deferred,
  emptySnapshot,
  flushMicrotasks,
  makeMockAdapter,
  makeMockInstance,
  testSessionId,
} from './__test-helpers__/realtime-session-harness.js';
import { RealtimeSession } from './realtime-session.js';
import type { SubmitIntentResult } from './realtime-session.types.js';

describe('RealtimeSession input mute', () => {
  it('mutes during a pending submit_intent while delivering its result, keeping mic inactive and epoch unchanged', async () => {
    const pending = deferred<SubmitIntentResult>();
    const h = makeMuteHarness();
    h.instance.submitIntent = async (intent) => {
      h.instance.submitted.push(intent);
      return pending.promise;
    };
    const muteEvents: boolean[] = [];
    h.session.on('input_muted', (muted) => muteEvents.push(muted));

    await h.session.connect();
    const generationBefore = h.session.observations.getSnapshot().generation;
    expect(h.session.observations.getSnapshot().media.microphone).toBe(
      'active',
    );

    const callId = 'call-mid-task';
    h.adapter.emitToolCall({
      callId,
      name: 'submit_intent',
      argumentsJson: JSON.stringify({ intent: 'filter tasks to Chris' }),
    });
    await flushMicrotasks();

    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(true);
    expect(muteEvents).toEqual([true]);
    expect(h.adapter.inputEnabledCalls).toEqual([false]);
    expect(h.session.observations.getSnapshot().media.microphone).toBe(
      'inactive',
    );
    expect(h.session.state).toBe('connected');
    expect(h.session.observations.getSnapshot().generation).toBe(
      generationBefore,
    );
    expect(h.adapter.disconnectCalls).toBe(0);

    pending.resolve({ userMessage: 'Filtered tasks to Chris.' });
    await flushMicrotasks();
    h.instance.settle();
    await flushMicrotasks();

    expect(h.adapter.toolResults).toHaveLength(1);
    expect(h.adapter.toolResults[0]?.callId).toBe(callId);
    expect(h.adapter.toolResults[0]?.output).toMatchObject({
      ok: true,
      userMessage: 'Filtered tasks to Chris.',
    });

    h.session.setInputMuted(false);
    expect(h.session.inputMuted).toBe(false);
    expect(muteEvents).toEqual([true, false]);
    expect(h.adapter.inputEnabledCalls).toEqual([false, true]);
    expect(h.session.observations.getSnapshot().media.microphone).toBe(
      'active',
    );
    expect(h.adapter.connectCalls).toBe(1);
    expect(h.adapter.disconnectCalls).toBe(0);
  });

  it('keeps turn control independent of mute, survives turn-mode switches, and resets on disconnect', async () => {
    const startTurn = mock(async () => {});
    const endTurn = mock(async () => {});
    const h = makeMuteHarness();
    h.adapter.setTurnControl({ startTurn, endTurn });
    const muteEvents: boolean[] = [];
    h.session.on('input_muted', (muted) => muteEvents.push(muted));

    // No-op while disconnected.
    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(false);
    expect(h.adapter.inputEnabledCalls).toEqual([]);

    await h.session.connect();
    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(true);

    // Switch to manual mode: mute survives.
    h.adapter.emitTurnMode('manual');
    expect(h.session.turnMode).toBe('manual');
    expect(h.session.inputMuted).toBe(true);

    // A press while muted still reaches the adapter, whose mute gate keeps
    // the turn silent. Unmuting inside the press leaves the turn running.
    const control = h.session.turnControl;
    await control?.startTurn();
    expect(startTurn).toHaveBeenCalledTimes(1);
    h.session.setInputMuted(false);
    expect(h.session.turnControl).toBe(control);
    await h.session.turnControl?.endTurn();
    expect(endTurn).toHaveBeenCalledTimes(1);
    expect(h.adapter.inputEnabledCalls).toEqual([false, true]);

    // Re-mute, switch back to automatic, then disconnect: mute resets.
    h.session.setInputMuted(true);
    h.adapter.emitTurnMode('automatic');
    expect(h.session.inputMuted).toBe(true);

    await h.session.disconnect();
    expect(h.session.inputMuted).toBe(false);
    expect(muteEvents).toEqual([true, false, true, false]);
  });

  it('lets the turn mode change while muted', async () => {
    const startTurn = mock(async () => {});
    const setTurnMode = mock(async () => {});
    const h = makeMuteHarness();
    h.adapter.setTurnControl({
      startTurn,
      endTurn: async () => {},
      setTurnMode,
    });
    await h.session.connect();
    h.session.setInputMuted(true);

    expect(h.session.turnMode).toBe('automatic');
    await h.session.turnControl?.setTurnMode?.('manual');
    expect(setTurnMode).toHaveBeenCalledWith('manual');

    h.adapter.emitTurnMode('manual');
    await h.session.turnControl?.startTurn();
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it('ignores a mute request when the adapter cannot gate its microphone', async () => {
    const h = makeMuteHarness(null);
    const observed: boolean[] = [];
    h.session.on('input_muted', (muted) => {
      observed.push(muted);
    });
    await h.session.connect();

    h.session.setInputMuted(true);

    expect(h.session.inputMuted).toBe(false);
    expect(observed).toEqual([]);
    expect(h.adapter.inputEnabledCalls).toEqual([]);
    expect(h.session.state).not.toBe('error');
    await h.session.disconnect();
  });

  it('returns to unmuted when the adapter rejects the mute, and a retry reaches the adapter again', async () => {
    let rejectNext = true;
    const h = makeMuteHarness((enabled) => {
      if (!enabled && rejectNext) {
        rejectNext = false;
        return Promise.reject(new Error('gate failed'));
      }
      return undefined;
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
    expect(h.adapter.inputEnabledCalls).toEqual([false, false]);
    expect(observed).toEqual([true, false, true]);
    await h.session.disconnect();
  });

  it('returns to unmuted when the adapter throws synchronously on mute', async () => {
    const h = makeMuteHarness((enabled) => {
      if (!enabled) throw new Error('gate failed');
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
    const h = makeMuteHarness((enabled) => {
      if (enabled) return undefined;
      muteCalls += 1;
      return muteCalls === 1 ? firstFailure : first.promise;
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
    const h = makeMuteHarness();
    await h.session.connect();
    const releaseDisconnect = h.adapter.gateDisconnect();
    h.session.setInputMuted(true);
    h.session.on('input_muted', (muted) => {
      if (!muted) h.session.setInputMuted(true);
    });

    const disconnecting = h.session.disconnect();
    expect(h.session.inputMuted).toBe(false);
    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(false);
    expect(h.adapter.inputEnabledCalls).toEqual([false]);

    releaseDisconnect();
    await disconnecting;
    expect(h.session.state).toBe('idle');
    expect(h.session.inputMuted).toBe(false);

    await h.session.connect();
    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(true);
    await h.session.disconnect();
  });

  it('resets mute on fatal adapter error', async () => {
    const h = makeMuteHarness();
    await h.session.connect();
    h.session.setInputMuted(true);
    expect(h.session.inputMuted).toBe(true);

    h.adapter.emitError(new RealtimeVoiceError('CONNECTION_FAILED', 'dropped'));
    expect(h.session.state).toBe('error');
    expect(h.session.inputMuted).toBe(false);
  });

  it('gates adapter input before notifying subscribers and isolates a throwing subscriber', async () => {
    const h = makeMuteHarness();
    await h.session.connect();
    const gateCallsAtNotify: boolean[][] = [];
    const later: boolean[] = [];
    h.session.on('input_muted', () => {
      gateCallsAtNotify.push([...h.adapter.inputEnabledCalls]);
      throw new Error('subscriber failed');
    });
    h.session.on('input_muted', (muted) => later.push(muted));

    expect(() => h.session.setInputMuted(true)).not.toThrow();

    expect(gateCallsAtNotify).toEqual([[false]]);
    expect(h.adapter.inputEnabledCalls).toEqual([false]);
    expect(h.session.inputMuted).toBe(true);
    expect(later).toEqual([true]);
  });

  it('keeps a re-entrant subscriber request as the final adapter gate state', async () => {
    const h = makeMuteHarness();
    await h.session.connect();
    const later: boolean[] = [];
    h.session.on('input_muted', (muted) => {
      if (muted) h.session.setInputMuted(false);
    });
    h.session.on('input_muted', (muted) => later.push(muted));

    h.session.setInputMuted(true);

    expect(h.session.inputMuted).toBe(false);
    expect(h.adapter.inputEnabledCalls).toEqual([false, true]);
    expect(later).toEqual([false]);
  });
});

function makeMuteHarness(
  inputControl: ((enabled: boolean) => void | Promise<void>) | null = () =>
    undefined,
) {
  const adapter = makeMockAdapter(inputControl ? { inputControl } : {});
  const instance = makeMockInstance(emptySnapshot);
  const session = new RealtimeSession({
    adapter,
    instance,
    sessionId: testSessionId,
  });
  return { session, adapter, instance };
}
