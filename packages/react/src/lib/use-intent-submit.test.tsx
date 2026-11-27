import { afterEach, describe, expect, it, mock } from 'bun:test';

import {
  type ActionResult,
  type Orchestrator,
  type VoiceSessionState,
  WireEngineError,
} from '@maelstrom-co/client';
import {
  agentAcceptedEvent,
  agentFinishedEvent,
  createMockAgentConnector,
} from '@maelstrom-co/client/_testing';
import {
  ActionName,
  type ChartRequestMessage,
  defineVessel,
  InstanceId,
  type MaelstromResponse,
  ok,
  RunId,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { act, cleanup, render } from '@testing-library/react';
import { useLayoutEffect, useRef, useState } from 'react';

import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstrom } from './create-maelstrom.js';
import {
  defaultShouldRestoreDraft,
  type IntentSubmitFailure,
  type UseIntentSubmitResult,
} from './use-intent-submit.js';
import { vessel } from './vessel.js';

afterEach(cleanup);

function slowConnector() {
  const sent: ChartRequestMessage[] = [];
  const pending: Array<{
    resolve: (value: MaelstromResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  const connector = createMockConnector({
    process: (request) => {
      sent.push(request);
      return new Promise((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
  });
  const finish = (
    index: number,
    executionPlan: MaelstromResponse['executionPlan'] = [],
    layout: MaelstromResponse['layout'] = {
      type: 'tiling',
      tree: [],
      instances: [],
    },
  ) =>
    pending[index].resolve({
      type: 'maelstrom_response',
      requestId: sent[index].id,
      layout,
      executionPlan,
      rationale: '',
      userMessage: 'Done',
    });
  return { connector, sent, pending, finish };
}

describe('useIntentSubmit', () => {
  it('keeps the draft on synchronous refusal, restores on async refusal, and never replays unknown outcomes', async () => {
    const clock = FakeTimers.install({
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    try {
      const { connector, sent } = slowConnector();
      const m = createMaelstrom({
        vessels: [],
        intentQueue: { capacity: 1, maxWaitMs: 1000, activeTimeoutMs: 2000 },
      });
      let api!: UseIntentSubmitResult;

      function Probe() {
        api = m.useIntentSubmit();
        return null;
      }

      await act(async () => {
        render(
          <m.Provider connector={connector}>
            <Probe />
          </m.Provider>,
        );
      });

      // 1. Accepted active request clears draft.
      act(() => {
        api.setDraft('active request');
      });
      await act(async () => {
        expect(api.submit()?.accepted).toBe(true);
      });
      expect(api.draft).toBe('');
      expect(sent).toHaveLength(1);

      // 2. Second request queues and clears draft; third is refused synchronously and keeps draft.
      act(() => {
        api.setDraft('queued request');
      });
      await act(async () => {
        expect(api.submit()?.accepted).toBe(true);
      });
      expect(api.draft).toBe('');

      act(() => {
        api.setDraft('refused full queue');
      });
      await act(async () => {
        expect(api.submit()?.accepted).toBe(false);
      });
      expect(api.draft).toBe('refused full queue');

      // 3. Clearing draft and letting the active request time out leaves outcome unknown without replay or restore.
      act(() => {
        api.setDraft('');
      });
      await act(async () => {
        await clock.tickAsync(2000);
      });
      expect(api.lastOutcome).toMatchObject({
        route: 'single-request',
        status: 'unknown',
      });
      expect(api.draft).toBe('');
      expect(sent).toHaveLength(1);
    } finally {
      clock.uninstall();
    }
  });

  it('does not write explicit submitted text into an empty draft when it fails', async () => {
    const { connector, sent, pending } = slowConnector();
    const m = createMaelstrom({ vessels: [] });
    const failures: IntentSubmitFailure[] = [];
    let api!: UseIntentSubmitResult;

    function Probe() {
      api = m.useIntentSubmit({
        shouldRestoreDraft: () => true,
        onFailure: (failure) => failures.push(failure),
      });
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Probe />
        </m.Provider>,
      );
    });

    await act(async () => {
      api.submit('explicit text');
    });
    expect(sent).toHaveLength(1);
    await act(async () => {
      pending[0].reject(
        new WireEngineError('401 invalid key', 'ProviderError'),
      );
    });
    expect(failures).toHaveLength(1);
    expect(api.draft).toBe('');
  });

  it('uses a pluggable failure classifier to decide which failures restore the draft without overwriting newer typing', async () => {
    const { connector, sent, pending } = slowConnector();
    const m = createMaelstrom({ vessels: [] });
    const failures: IntentSubmitFailure[] = [];
    let api!: UseIntentSubmitResult;

    const shouldRestoreDraft = (failure: IntentSubmitFailure): boolean => {
      if (defaultShouldRestoreDraft(failure)) return true;
      return (
        failure.route === 'single-request' &&
        (failure.result.status === 'failed' ||
          failure.result.status === 'unknown') &&
        failure.result.error instanceof WireEngineError &&
        failure.result.error.code === 'ProviderError'
      );
    };

    function Probe() {
      api = m.useIntentSubmit({
        shouldRestoreDraft,
        onFailure: (failure) => failures.push(failure),
      });
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Probe />
        </m.Provider>,
      );
    });

    // Classifier returns true -> restores draft and never replays.
    act(() => {
      api.setDraft('restore me');
    });
    await act(async () => {
      api.submit();
    });
    expect(api.draft).toBe('');
    await act(async () => {
      pending[0].reject(
        new WireEngineError('401 invalid key', 'ProviderError'),
      );
    });
    expect(api.draft).toBe('restore me');
    expect(sent).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Classifier returns false -> leaves draft cleared.
    act(() => {
      api.setDraft('do not restore');
    });
    await act(async () => {
      api.submit();
    });
    expect(api.draft).toBe('');
    await act(async () => {
      pending[1].reject(new Error('network blip'));
    });
    expect(api.draft).toBe('');
    expect(api.lastOutcome).toMatchObject({
      route: 'single-request',
      status: 'unknown',
    });
    expect(sent).toHaveLength(2);

    // Newer typing (even if cleared) blocks restore of an older classified failure.
    act(() => {
      api.setDraft('older');
    });
    await act(async () => {
      api.submit();
    });
    act(() => {
      api.setDraft('newer');
    });
    act(() => {
      api.setDraft('');
    });
    await act(async () => {
      pending[2].reject(
        new WireEngineError('401 invalid key', 'ProviderError'),
      );
    });
    expect(api.draft).toBe('');
    expect(sent).toHaveLength(3);
  });

  it('supports submitting explicit chip text without clearing an unrelated draft', async () => {
    const { connector, sent } = slowConnector();
    const m = createMaelstrom({ vessels: [] });
    let api!: UseIntentSubmitResult;

    function Probe() {
      api = m.useIntentSubmit();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Probe />
        </m.Provider>,
      );
    });

    act(() => {
      api.setDraft('work in progress');
    });
    await act(async () => {
      expect(api.submit('  example chip  ')?.accepted).toBe(true);
    });
    expect(api.draft).toBe('work in progress');
    expect(sent).toHaveLength(1);
    expect(sent[0].request.context.updateReasons).toContainEqual({
      type: 'user_intent',
      intent: 'example chip',
    });
  });

  it('does not restore an older classified failure after the parent edits and clears a controlled draft', async () => {
    const { connector, sent, pending } = slowConnector();
    const m = createMaelstrom({ vessels: [] });
    let api!: UseIntentSubmitResult;
    let setParentDraft!: (value: string) => void;

    const shouldRestoreDraft = (failure: IntentSubmitFailure): boolean =>
      defaultShouldRestoreDraft(failure) ||
      (failure.route === 'single-request' &&
        failure.result.status !== 'not_submitted' &&
        failure.result.error instanceof WireEngineError &&
        failure.result.error.code === 'ProviderError');

    function Probe() {
      const [draft, setDraft] = useState('');
      setParentDraft = setDraft;
      api = m.useIntentSubmit({
        draft,
        onDraftChange: setDraft,
        shouldRestoreDraft,
      });
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Probe />
        </m.Provider>,
      );
    });

    act(() => {
      setParentDraft('older');
    });
    await act(async () => {
      api.submit();
    });
    expect(api.draft).toBe('');
    act(() => {
      setParentDraft('newer');
    });
    act(() => {
      setParentDraft('');
    });
    await act(async () => {
      pending[0].reject(
        new WireEngineError('401 invalid key', 'ProviderError'),
      );
    });
    expect(api.draft).toBe('');
    expect(sent).toHaveLength(1);

    act(() => {
      setParentDraft('untouched');
    });
    await act(async () => {
      api.submit();
    });
    expect(api.draft).toBe('');
    await act(async () => {
      pending[1].reject(
        new WireEngineError('401 invalid key', 'ProviderError'),
      );
    });
    expect(api.draft).toBe('untouched');
    expect(sent).toHaveLength(2);
  });

  it('does not call onFailure after unmount for a submission made before the passive effect ran', async () => {
    const { connector, sent, pending } = slowConnector();
    const m = createMaelstrom({ vessels: [] });
    const failures: IntentSubmitFailure[] = [];
    let setShowProbe!: (value: boolean) => void;

    function Probe() {
      const api = m.useIntentSubmit({
        onFailure: (failure) => failures.push(failure),
      });
      const submitted = useRef(false);
      useLayoutEffect(() => {
        if (submitted.current) return;
        submitted.current = true;
        api.submit('submitted during layout');
      });
      return null;
    }

    function Host() {
      const [showProbe, setShow] = useState(false);
      setShowProbe = setShow;
      return showProbe ? <Probe /> : null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Host />
        </m.Provider>,
      );
    });

    await act(async () => {
      setShowProbe(true);
    });
    expect(sent).toHaveLength(1);

    await act(async () => {
      setShowProbe(false);
    });
    await act(async () => {
      pending[0].reject(new Error('network blip'));
    });
    expect(failures).toEqual([]);
  });

  it('restores the draft of a submission made before the passive effect ran', async () => {
    const { connector, sent, pending } = slowConnector();
    const m = createMaelstrom({ vessels: [] });
    const failures: IntentSubmitFailure[] = [];
    let api!: ReturnType<typeof m.useIntentSubmit>;
    let setShowProbe!: (value: boolean) => void;

    function Probe() {
      api = m.useIntentSubmit({
        initialDraft: 'layout draft',
        shouldRestoreDraft: () => true,
        onFailure: (failure) => failures.push(failure),
      });
      const submitted = useRef(false);
      useLayoutEffect(() => {
        if (submitted.current) return;
        submitted.current = true;
        api.submit();
      });
      return null;
    }

    function Host() {
      const [showProbe, setShow] = useState(false);
      setShowProbe = setShow;
      return showProbe ? <Probe /> : null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Host />
        </m.Provider>,
      );
    });

    await act(async () => {
      setShowProbe(true);
    });
    expect(sent).toHaveLength(1);
    expect(api.draft).toBe('');

    await act(async () => {
      pending[0].reject(
        new WireEngineError('401 invalid key', 'ProviderError'),
      );
    });
    expect(api.draft).toBe('layout draft');
    expect(failures).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('reports busy across planning, applying, open agent runs, and voice', async () => {
    const cardVessel = defineVessel({
      id: 'card',
      name: 'Card',
      description: 'Test card',
      defaultVariant: 'default',
      variants: {
        default: {
          minSize: { width: 2, height: 2 },
          props: {},
          actions: [{ name: 'load', description: 'Load card' }],
        },
      },
    });
    const cardEntry = vessel(cardVessel, () => null);
    const { connector, sent, finish } = slowConnector();
    const m = createMaelstrom({ vessels: [cardEntry] as const }).with(
      (context) => ({
        useContext: context.useMaelstromContext,
      }),
    );

    let api!: UseIntentSubmitResult;
    let client!: Orchestrator;
    let setVoiceState!: (state: VoiceSessionState) => void;

    function Probe() {
      client = m.useContext().orchestrator;
      const [voiceState, updateVoice] = useState<VoiceSessionState>('idle');
      setVoiceState = updateVoice;
      api = m.useIntentSubmit({ voiceState });
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Probe />
        </m.Provider>,
      );
    });

    expect(api.busy).toBe(false);

    // Voice thinking -> busy.
    act(() => {
      setVoiceState('thinking');
    });
    expect(api.busy).toBe(true);
    act(() => {
      setVoiceState('connected');
    });
    expect(api.busy).toBe(false);

    // Planning -> busy, then applying (in-flight action) -> still busy, then idle -> false.
    let resolveAction!: (result: ActionResult) => void;
    const runner = mock(
      () =>
        new Promise<ActionResult>((resolve) => {
          resolveAction = resolve;
        }),
    );
    client.commandProcessor.registerRunner(InstanceId('card-1'), {
      load: runner,
    });

    await act(async () => {
      api.submit('load card');
    });
    expect(api.busy).toBe(true);
    expect(sent).toHaveLength(1);

    await act(async () => {
      finish(
        0,
        [{ instanceId: InstanceId('card-1'), action: ActionName('load') }],
        {
          type: 'tiling',
          tree: [tilingLeafToken(InstanceId('card-1'))],
          instances: [
            {
              instanceId: InstanceId('card-1'),
              vesselId: VesselId('card'),
              variant: VariantName('default'),
            },
          ],
        },
      );
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(api.busy).toBe(true);

    await act(async () => {
      resolveAction(ok(undefined));
    });
    expect(api.busy).toBe(false);
  });

  it('tracks open agent runs in busy, restores on send_failed, and keeps lost runs unknown without replay', async () => {
    const agent = createMockAgentConnector();
    const m = createMaelstrom({ vessels: [], intentRoute: 'agent' });
    let api!: UseIntentSubmitResult;

    function Probe() {
      api = m.useIntentSubmit();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={agent.connector}>
          <Probe />
        </m.Provider>,
      );
    });

    expect(api.busy).toBe(false);

    // Accepted agent run keeps busy true until finished.
    act(() => {
      api.setDraft('show orders');
    });
    await act(async () => {
      expect(api.submit()?.accepted).toBe(true);
    });
    expect(api.draft).toBe('');
    expect(api.busy).toBe(true);
    expect(agent.inputs).toHaveLength(1);

    const runId = RunId('run-1');
    const firstInput = agent.inputs[0];
    if (!firstInput || firstInput.type !== 'utterance') {
      throw new Error('expected first utterance');
    }
    await act(async () => {
      agent.emit(agentAcceptedEvent(firstInput.inputId, runId));
    });
    expect(api.busy).toBe(true);

    await act(async () => {
      agent.emit(agentFinishedEvent(runId, { reply: 'Here are your orders.' }));
    });
    expect(api.busy).toBe(false);
    expect(api.lastOutcome).toMatchObject({
      route: 'agent',
      status: 'finished',
    });

    // Disconnecting mid-run settles as lost (unknown) and does NOT restore draft or replay.
    act(() => {
      api.setDraft('check out');
    });
    await act(async () => {
      expect(api.submit()?.accepted).toBe(true);
    });
    expect(api.draft).toBe('');
    expect(api.busy).toBe(true);
    const run2 = RunId('run-2');
    const secondInput = agent.inputs[1];
    if (!secondInput || secondInput.type !== 'utterance') {
      throw new Error('expected second utterance');
    }
    await act(async () => {
      agent.emit(agentAcceptedEvent(secondInput.inputId, run2));
      agent.close({ clean: false });
    });
    expect(api.busy).toBe(false);
    expect(api.draft).toBe('');
    expect(api.lastOutcome).toMatchObject({
      route: 'agent',
      status: 'lost',
      result: { lostReason: 'disconnected' },
    });
    expect(agent.inputs).toHaveLength(2);
  });
});
