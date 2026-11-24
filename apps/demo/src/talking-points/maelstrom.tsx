import type { Orchestrator } from '@maelstrom-co/client';
import {
  InstanceId,
  ok,
  type TilingLayout,
  type TilingNode,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import {
  createMaelstrom,
  type DynamicVesselHandle,
  type TypedVesselProps,
  vessel,
} from '@maelstrom-co/react';
import { maelstromRealtime } from '@maelstrom-co/react-realtime';
import { useEffect, useSyncExternalStore } from 'react';

import { registerDemoVoice } from '../lib/demo-voice';
import { createAdapter } from '../lib/voice-adapter';
import type { DemoVoiceProvider } from '../lib/voice-provider';
import {
  createPreparationOwner,
  type OutlineStore,
  type Topic,
} from './outline.store';
import { outlineDefinition, topicDefinition } from './vessels';

export const PREPARATION_VOICE_PROVIDERS = ['live', 'realtime'] as const;
export type PreparationVoiceProvider =
  (typeof PREPARATION_VOICE_PROVIDERS)[number];

export function preparationVoiceProvider(
  provider: DemoVoiceProvider,
): PreparationVoiceProvider {
  return provider === 'livekit' ? 'live' : provider;
}

export const PREPARATION_LAYOUT: TilingLayout = outlineLayout([]);

export function createPreparationRuntime(
  store: OutlineStore,
  provider: PreparationVoiceProvider,
) {
  const owner = createPreparationOwner();
  const writer = store.forOwner(owner);
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
      }),
    )
    .with((ctx) => ({
      usePreparationProjection: () => {
        const { orchestrator } = ctx.useMaelstromContext();
        useEffect(() => synchronize(orchestrator), [orchestrator]);
      },
    }));

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
        <h2>Your outline</h2>
        <p>
          {snapshot.topics.length
            ? `${snapshot.topics.length} Topics · ordered from top to bottom`
            : 'Start with “Add an opening, the main idea, and a closing question.”'}
        </p>
        <p className="talking-points-hint">
          Prepare by voice or text. Only Topic content and order are saved in
          this browser when storage is available.
        </p>
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
          className="talking-points-topic"
          aria-label={current.content}
          data-topic-id={topic.id}
          data-spoken={spoken}
        >
          <span className="talking-points-number">
            {snapshot.topics.indexOf(current) + 1}
          </span>
          <p>{current.content}</p>
          <button
            type="button"
            aria-pressed={spoken}
            onClick={() => executeAction(spoken ? 'unmark' : 'mark')}
          >
            {spoken ? 'Unmark spoken' : 'Mark spoken'}
          </button>
          {spoken && <span className="talking-points-spoken">Spoken</span>}
        </article>
      );
    }
    handle = m.registerVessel(vessel(definition, TopicComponent));
    return { handle, content: topic.content };
  }

  function synchronize(orchestrator: Orchestrator) {
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
      const layout = outlineLayout(snapshot.topics);
      if (
        JSON.stringify(processor.store.state.layout) !== JSON.stringify(layout)
      )
        processor.setLayout(layout);
    };
    const unsubscribeStore = store.subscribe(publish);
    const unsubscribeSettled = orchestrator.onSettled(publish);
    publish();
    return () => {
      unsubscribeStore();
      unsubscribeSettled();
    };
  }

  return { m, owner, writer };
}

function outlineLayout(topics: readonly Topic[]): TilingLayout {
  const ids = [
    InstanceId('outline-main'),
    ...topics.map((topic) => InstanceId(`topic-${topic.id}-main`)),
  ];
  return {
    type: 'tiling',
    tree: ids.flatMap<TilingNode>((id, index) =>
      index < ids.length - 1
        ? [`H:1,${ids.length - index - 1}`, tilingLeafToken(id)]
        : [tilingLeafToken(id)],
    ),
    instances: [
      {
        instanceId: InstanceId('outline-main'),
        vesselId: VesselId('outline'),
        variant: VariantName('prepare'),
      },
      ...topics.map((topic) => ({
        instanceId: InstanceId(`topic-${topic.id}-main`),
        vesselId: VesselId(`topic-${topic.id}`),
        variant: VariantName('topic'),
      })),
    ],
  };
}

export type PreparationRuntime = ReturnType<typeof createPreparationRuntime>;

function apply(mutate: () => void) {
  mutate();
  return ok(undefined);
}
