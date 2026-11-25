import type { Orchestrator } from '@maelstrom-co/client';
import { ok } from '@maelstrom-co/protocol';
import {
  createMaelstrom,
  type DynamicVesselHandle,
  type TypedVesselProps,
  vessel,
} from '@maelstrom-co/react';
import { devtools } from '@maelstrom-co/react-devtools/production';
import { maelstromRealtime } from '@maelstrom-co/react-realtime';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { registerDemoVoice } from '../lib/demo-voice';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { createAdapter } from '../lib/voice-adapter';
import type { DemoVoiceProvider } from '../lib/voice-provider';
import { liveLayout, liveTopicDefinition } from './live-plan';
import type { LiveTake } from './live-take';
import {
  createPreparationOwner,
  type OutlineStore,
  type Topic,
} from './outline.store';
import { createPreparationAdmission } from './preparation-admission';
import {
  MOBILE_TOPIC_MEDIA,
  preparationLayout,
  TOPIC_ROW_HEIGHT,
} from './preparation-layout';
import { createSemanticCoverage } from './semantic-coverage';
import { outlineDefinition, topicDefinition } from './vessels';

export const PREPARATION_VOICE_PROVIDERS = ['live', 'realtime'] as const;
export type PreparationVoiceProvider =
  (typeof PREPARATION_VOICE_PROVIDERS)[number];

export function preparationVoiceProvider(
  provider: DemoVoiceProvider,
): PreparationVoiceProvider {
  return provider === 'livekit' ? 'live' : provider;
}

export const PREPARATION_LAYOUT = preparationLayout([]);

export function createPreparationRuntime(
  store: OutlineStore,
  provider: PreparationVoiceProvider,
) {
  const owner = createPreparationOwner();
  const admission = createPreparationAdmission();
  const writer = store.forOwner(owner);
  writer.clearSpoken();
  const initialDefinition = outlineDefinition(store.getSnapshot().topics);
  const m = createMaelstrom({
    vessels: [vessel(initialDefinition, OutlineController)] as const,
    motion: { disabled: true },
  })
    .with(
      maelstromRealtime({
        providers: PREPARATION_VOICE_PROVIDERS,
        initialProvider: provider,
        createAdapter: ({ provider: selected, sessionId }) =>
          createAdapter(selected, sessionId),
        conversationInstructions:
          'You help prepare an ordered speaking outline in Talking Points. Submit all requested outline changes as natural-language intent. This is preparation, not a live speaking take.',
        onSession: registerDemoVoice,
        createIntentScope: (orchestrator: Orchestrator) =>
          admission.wrap(orchestrator.createIntentScope()),
      }),
    )
    .with((ctx) => ({
      usePreparationIntake: () => {
        const { orchestrator } = ctx.useMaelstromContext();
        const [scope] = useState(() =>
          admission.wrap(orchestrator.createIntentScope()),
        );
        return scope;
      },
      usePreparationProjection: () => {
        const { orchestrator } = ctx.useMaelstromContext();
        useEffect(() => synchronize(orchestrator), [orchestrator]);
      },
    }))
    .with(devtools({ capture: diagnosticCapture }));

  function OutlineController({
    instanceId,
  }: TypedVesselProps<typeof initialDefinition>) {
    const snapshot = useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    );
    m.useActions('outline', instanceId, {
      createTopic: ({ content }) => apply(() => writer.create(content)),
      editTopic: ({ topic, content }) =>
        apply(() => writer.edit(topic, content)),
      removeTopic: ({ topic }) => apply(() => writer.remove(topic)),
      moveTopic: ({ topic, position }) =>
        apply(() => writer.move(topic, position)),
    });
    return (
      <section
        className="talking-points-controller"
        aria-label="Outline preparation"
      >
        <div className="talking-points-outline-heading">
          <h2>Your outline</h2>
          <span>{snapshot.topics.length} Topics</span>
        </div>
        {!snapshot.topics.length && (
          <p>Add your first Topic by voice or text below.</p>
        )}
      </section>
    );
  }

  function registerTopic(topic: Topic) {
    const definition = topicDefinition(topic);
    let handle: DynamicVesselHandle<typeof definition>;
    function TopicComponent({
      instanceId,
      executeAction,
    }: TypedVesselProps<typeof definition>) {
      const snapshot = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot,
      );
      const current = snapshot.topics.find(
        (candidate) => candidate.id === topic.id,
      );
      handle.useActions(instanceId, {
        mark: () => apply(() => writer.setSpoken(topic.id, true)),
        unmark: () => apply(() => writer.setSpoken(topic.id, false)),
      });
      if (!current) return null;
      const spoken = snapshot.spoken.has(topic.id);
      return (
        <article
          className="talking-points-topic vessel-card"
          aria-label={current.content}
          data-topic-id={topic.id}
          data-spoken={spoken}
        >
          <span
            className="talking-points-check"
            role="checkbox"
            aria-label="Spoken"
            aria-checked={spoken}
            aria-readonly="true"
          >
            <span aria-hidden="true">{spoken ? '✓' : ''}</span>
          </span>
          <p
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to focus overflowing Topic content.
            tabIndex={0}
          >
            {current.content}
          </p>
          {spoken && (
            <button
              className="btn btn-ghost"
              type="button"
              aria-pressed={spoken}
              onClick={() => executeAction('unmark')}
            >
              Unmark spoken
            </button>
          )}
        </article>
      );
    }
    handle = m.registerVessel(vessel(definition, TopicComponent));
    return { handle, content: topic.content };
  }

  function synchronize(orchestrator: Orchestrator) {
    const mobile = window.matchMedia(MOBILE_TOPIC_MEDIA);
    const topics = new Map<string, ReturnType<typeof registerTopic>>();
    let publishedOutline = '';
    const publish = () => {
      if (!owner.isActive()) return;
      const processor = orchestrator.commandProcessor;
      if (processor.store.state.status !== 'idle' || processor.queueLength)
        return;
      const snapshot = store.getSnapshot();
      const serialized = JSON.stringify(snapshot.topics);
      if (serialized !== publishedOutline) {
        const result = m.updateVessel(outlineDefinition(snapshot.topics));
        if (!result.ok) {
          if (result.conflict.code !== 'batch_in_flight')
            throw new Error(result.conflict.message);
          return;
        }
        publishedOutline = serialized;
      }
      for (const topic of snapshot.topics) {
        const registered = topics.get(topic.id);
        if (!registered) topics.set(topic.id, registerTopic(topic));
        else if (registered.content !== topic.content) {
          const result = registered.handle.update(topicDefinition(topic));
          if (!result.ok) {
            if (result.conflict.code !== 'batch_in_flight')
              throw new Error(result.conflict.message);
            return;
          }
          registered.content = topic.content;
        }
      }
      for (const [id, registered] of topics) {
        if (snapshot.topics.some((topic) => topic.id === id)) continue;
        registered.handle.unregister();
        topics.delete(id);
      }
      // Registration only publishes capabilities. This separate app-owned projection creates visible Instances after the response batch.
      const layout = preparationLayout(
        snapshot.topics,
        mobile.matches ? TOPIC_ROW_HEIGHT.mobile : TOPIC_ROW_HEIGHT.desktop,
      );
      if (
        JSON.stringify(processor.store.state.layout) !== JSON.stringify(layout)
      )
        processor.setLayout(layout);
    };
    mobile.addEventListener('change', publish);
    const unsubscribeStore = store.subscribe(publish);
    const unsubscribeSettled = orchestrator.onSettled(publish);
    publish();
    return () => {
      mobile.removeEventListener('change', publish);
      unsubscribeStore();
      unsubscribeSettled();
    };
  }

  return { m, owner, writer, admission };
}

export type PreparationRuntime = ReturnType<typeof createPreparationRuntime>;

function apply(mutate: () => void) {
  mutate();
  return ok(undefined);
}

export function createLiveRuntime(take: LiveTake) {
  let settleEngine!: () => void;
  const engineReady = new Promise<void>((resolve) => {
    settleEngine = resolve;
  });
  let failEngine = () => {
    take.engineFailed();
    settleEngine();
  };
  const topics = take.getSnapshot().topics;
  let coverage: ReturnType<typeof createSemanticCoverage> | undefined;
  const entries = topics.map((topic) => {
    const definition = liveTopicDefinition(topic);
    function LiveTopic({ instanceId }: TypedVesselProps<typeof definition>) {
      const snapshot = useSyncExternalStore(
        take.subscribe,
        take.getSnapshot,
        take.getSnapshot,
      );
      m.useActions(definition.id, instanceId, {
        mark: () =>
          apply(() => {
            if (coverage?.canMark()) take.automaticMark(topic.id);
          }),
      });
      const spoken = snapshot.spoken.has(topic.id);
      return (
        <article
          className="talking-points-topic vessel-card"
          aria-label={topic.content}
          data-topic-id={topic.id}
          data-spoken={spoken}
        >
          <span
            className="talking-points-check"
            role="checkbox"
            aria-label="Spoken"
            aria-checked={spoken}
            aria-readonly="true"
          >
            <span aria-hidden="true">{spoken ? '✓' : ''}</span>
          </span>
          <p
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to focus overflowing Topic content.
            tabIndex={0}
          >
            {topic.content}
          </p>
          {spoken && (
            <button
              className="btn btn-ghost"
              type="button"
              aria-pressed={spoken}
              disabled={
                snapshot.phase === 'preparing' || snapshot.phase === 'starting'
              }
              onClick={() => take.manualSet(topic.id, false)}
            >
              Unmark spoken
            </button>
          )}
        </article>
      );
    }
    return vessel(definition, LiveTopic);
  });
  let retirePending = () => {};
  const m = createMaelstrom({
    vessels: entries,
    motion: { disabled: true },
  })
    .with((ctx) => {
      ctx.onOrchestrator?.((orchestrator) => {
        const releaseDiagnostics = orchestrator.diagnostics.addDiagnosticSource(
          () =>
            take.diagnostics.subscribe((kind, metadata) => {
              orchestrator.diagnostics.emitDiagnostic(kind, metadata);
            }),
        );
        coverage = createSemanticCoverage(take, orchestrator);
        const original = coverage;
        retirePending = () => original.retire();
        let observing = true;
        let attempted = false;
        let failed = false;
        const fail = () => {
          if (!observing || failed) return;
          failed = true;
          take.engineFailed();
          settleEngine();
          // Cancel transport retries without replacing the original active ticket.
          void orchestrator.disconnect().catch(() => {});
        };
        failEngine = fail;
        const unsubscribeStatus = orchestrator.connectionManager.events.on(
          'connection_status_changed',
          ({ status }) => {
            if (!observing || failed) return;
            if (status === 'connecting') attempted = true;
            else if (status === 'connected') settleEngine();
            else if (status === 'error' || attempted) fail();
          },
        );
        const unsubscribeError = orchestrator.connectionManager.events.on(
          'connection_error',
          fail,
        );
        return () => {
          observing = false;
          releaseDiagnostics();
          unsubscribeStatus();
          unsubscribeError();
          original.retire();
        };
      });
      return {};
    })
    .with(devtools({ capture: diagnosticCapture }));
  return {
    m,
    engineReady,
    engineFailed: () => failEngine(),
    layout: liveLayout(topics.map((topic) => topic.id)),
    retirePending: () => retirePending(),
  };
}
export type LiveRuntime = ReturnType<typeof createLiveRuntime>;
