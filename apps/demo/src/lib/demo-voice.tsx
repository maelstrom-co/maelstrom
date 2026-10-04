import type { Orchestrator, TranscriptEntry } from '@maelstrom-co/client';
import type { MaelstromExtensionContext } from '@maelstrom-co/react';
import type {
  UseVoiceResult,
  VoiceOrbProps,
} from '@maelstrom-co/react-realtime';
import {
  GreetingCoordinator,
  type GreetingRunContext,
  type RealtimeInstance,
  type RealtimeProviderAdapter,
  RealtimeSession,
  RealtimeSessionMemory,
  RealtimeVoiceError,
} from '@maelstrom-co/realtime';
import { OpenAILiveAdapter } from '@maelstrom-co/realtime-openai-live';
import { LiveTransportError } from '@maelstrom-co/realtime-protocol/openai-live';
import { Mic, Square } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { diagnosticCapture } from './diagnostic-capture';
import { VoiceDiagnostics } from './voice-diagnostics';
import {
  type DemoVoiceProvider,
  LIVE_BACKEND_MODEL,
  LIVE_MODEL,
  selectVoiceProvider,
  voiceProviderStore,
} from './voice-provider';

function bridge(o: Orchestrator): RealtimeInstance {
  return {
    submitIntent: (intent) =>
      o
        .processIntent(intent)
        .then((response) => ({ userMessage: response.userMessage })),
    waitForIdle: async () => {
      await o.commandProcessor.waitForIdle();
    },
    waitForIdleResult: () => o.commandProcessor.waitForIdle(),
    getStructuralSnapshot: () => o.getStructuralSnapshot(),
    getCapabilitySnapshot: () => o.getCapabilitySnapshot(),
    onSettled: (handler) => o.onSettled(handler),
    addAssistantMessageAcknowledged: (args) =>
      o.addAssistantMessageAcknowledged(args),
    observeEngineConnection: (handler) => {
      const release = o.connectionManager.events.on(
        'connection_status_changed',
        (event) => handler(event.status === 'connected'),
      );
      handler(o.connectionManager.store.state.connectionStatus === 'connected');
      return release;
    },
    applicationWork: {
      getSnapshot: () => ({
        planning: o.requestCoordinator.isProcessing ? 'active' : 'inactive',
        applying:
          o.commandProcessor.store.state.status === 'error'
            ? 'unknown'
            : o.commandProcessor.store.state.status === 'processing' ||
                o.commandProcessor.queueLength > 0
              ? 'active'
              : 'inactive',
      }),
      subscribe: (handler) => {
        const a = o.requestCoordinator.store.subscribe(handler);
        const b = o.commandProcessor.store.subscribe(handler);
        return () => {
          a.unsubscribe();
          b.unsubscribe();
        };
      },
    },
  };
}

type Factory = (
  provider: DemoVoiceProvider,
  sessionId: ReturnType<Orchestrator['getConfig']>['sessionId'],
) => RealtimeProviderAdapter;

class DemoGreetingCoordinator extends GreetingCoordinator {
  constructor(private readonly memory: RealtimeSessionMemory) {
    super();
  }

  override run(context: GreetingRunContext) {
    return super.run({
      ...context,
      adapter: {
        connect: (options) => context.adapter.connect(options),
        disconnect: () => context.adapter.disconnect(),
        getAudioStreams: () => context.adapter.getAudioStreams(),
        sendToolResult: (id, result) =>
          context.adapter.sendToolResult(id, result),
        injectGrounding: (text) => context.adapter.injectGrounding(text),
        on: (handler) => context.adapter.on(handler),
        activateAudio: () => context.adapter.activateAudio(),
        speakAssistantText: (args) => {
          // A provider switch must retain the attempt before interrupted playback settles.
          this.memory.claimIntroduction();
          return context.adapter.speakAssistantText(args);
        },
      },
    });
  }
}

export class DemoVoiceOwner {
  readonly diagnostics = new VoiceDiagnostics();
  readonly memory: RealtimeSessionMemory;
  readonly coordinator: GreetingCoordinator;
  session: RealtimeSession;
  adapter: RealtimeProviderAdapter;
  provider = voiceProviderStore.state.provider;
  providerInstanceId = crypto.randomUUID();
  private changing = false;
  private ending = false;
  private endPromise?: Promise<void>;
  private switching?: Promise<void>;
  private revision = 0;
  private listeners = new Set<() => void>();
  private releases: (() => void)[] = [];
  private userTranscript?: TranscriptEntry;
  private assistantTranscript?: TranscriptEntry;
  private consumers = 0;
  private retired = false;

  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly factory: Factory,
    private readonly greeting: string,
  ) {
    this.memory = new RealtimeSessionMemory(orchestrator.getConfig().sessionId);
    this.coordinator = new DemoGreetingCoordinator(this.memory);
    this.adapter = factory(this.provider, this.memory.sessionId);
    this.session = this.createSession();
    this.observe();
    orchestrator.onSettled(() => {
      diagnosticCapture.record('application_settled', {
        sessionId: this.memory.sessionId,
        providerInstanceId: this.providerInstanceId,
        snapshot: orchestrator.getStructuralSnapshot(),
      });
    });
    orchestrator.requestCoordinator.events.on('processing_started', (event) =>
      this.diagnostics.record({
        at: Date.now(),
        kind: 'engine_started',
        id: event.requestId,
      }),
    );
    orchestrator.requestCoordinator.events.on('processing_completed', (event) =>
      this.diagnostics.record({
        at: Date.now(),
        kind: 'engine_completed',
        id: event.requestId,
        durationMs: event.durationMs,
      }),
    );
    orchestrator.requestCoordinator.events.on('error', () =>
      this.diagnostics.record({ at: Date.now(), kind: 'engine_error' }),
    );
  }

  private createSession(
    adapter = this.adapter,
    provider = this.provider,
    providerInstanceId = this.providerInstanceId,
  ) {
    const session = new RealtimeSession({
      adapter,
      instance: bridge(this.orchestrator),
      sessionId: this.memory.sessionId,
      memory: this.memory,
      ...(provider === 'live'
        ? this.coordinator.getSnapshot(this.memory.sessionId).lifecycle !==
          'terminal'
          ? {
              generatedOpening: {
                instructions:
                  'In English, briefly introduce yourself as Maelstrom and offer to arrange this workspace.',
              },
            }
          : {}
        : { greeting: { text: this.greeting, coordinator: this.coordinator } }),
    });
    // Tool events stay recorded for the session's whole life: an update can
    // settle after End voice or a provider switch released the lifecycle view.
    let generation = 0;
    session.events.subscribe((event) => {
      if (event.type === 'session.started') generation = event.generation;
      diagnosticCapture.sessionEvent(event, {
        provider,
        providerInstanceId,
        generation,
      });
      if (event.type === 'tool.called' || event.type === 'tool.result')
        this.diagnostics.onSessionEvent(event, {
          provider,
          providerInstanceId,
          generation,
        });
    });
    return session;
  }

  private retainTransport(
    adapter = this.adapter,
    providerInstanceId = this.providerInstanceId,
  ) {
    if (adapter instanceof OpenAILiveAdapter)
      this.diagnostics.retainTransport(adapter.getTransportSnapshot(), {
        providerInstanceId,
        model: LIVE_MODEL,
        backendModel: LIVE_BACKEND_MODEL,
      });
  }

  private observe() {
    const session = this.session;
    const provider = this.provider;
    const providerInstanceId = this.providerInstanceId;
    let generation = 0;
    this.releases = [
      session.observations.subscribe(() =>
        diagnosticCapture.observations(session.observations.getSnapshot(), {
          provider,
          providerInstanceId,
        }),
      ),
      session.events.subscribe((event) => {
        if (event.type === 'session.started') generation = event.generation;
        if (event.type !== 'tool.called' && event.type !== 'tool.result')
          this.diagnostics.onSessionEvent(event, {
            provider,
            providerInstanceId,
          });
      }),
      this.session.on('state', (state) => {
        const error = this.session.lastError;
        const cause = error instanceof RealtimeVoiceError ? error.cause : error;
        if (
          state === 'error' ||
          state === 'listening' ||
          state === 'thinking' ||
          state === 'speaking'
        )
          this.diagnostics.record({
            at: Date.now(),
            kind: state === 'error' ? 'voice_error' : 'voice_state',
            provider,
            providerInstanceId,
            state,
            generation,
            status:
              cause instanceof LiveTransportError ? cause.status : undefined,
          });
        if (state === 'error' || state === 'idle') this.retainTransport();
        this.notify();
      }),
      this.session.on('greeting_state', this.notify),
      this.session.on('turn_mode', this.notify),
      this.session.on('transcript', (entry) => {
        const previous =
          entry.role === 'user'
            ? this.userTranscript
            : this.assistantTranscript;
        const next = entry.final
          ? entry
          : {
              ...entry,
              text:
                (previous && !previous.final ? previous.text : '') + entry.text,
            };
        if (entry.role === 'user') this.userTranscript = next;
        else this.assistantTranscript = next;
        this.notify();
      }),
    ];
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.revision;
  private notify = () => {
    this.revision++;
    for (const listener of this.listeners) listener();
  };

  connect = (): Promise<void> => {
    if (this.changing || this.ending || this.retired) return Promise.resolve();
    const adapter = this.adapter;
    const providerInstanceId = this.providerInstanceId;
    this.retainTransport();
    return this.session
      .connect()
      .finally(() => this.retainTransport(adapter, providerInstanceId));
  };
  disconnect = (): Promise<void> => {
    if (this.endPromise) return this.endPromise;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const operation = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    this.endPromise = operation;
    this.ending = true;
    void this.endVoice().then(resolve, reject);
    this.notify();
    return operation;
  };

  private async endVoice() {
    try {
      await this.session.disconnect();
    } finally {
      this.retainTransport();
      this.ending = false;
      this.endPromise = undefined;
      this.notify();
    }
  }
  skipGreeting = () => this.session.skipGreeting();

  select = (provider: DemoVoiceProvider): Promise<void> => {
    if (this.switching) return this.switching;
    if (this.retired || provider === this.provider) return Promise.resolve();
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const operation = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    this.switching = operation;
    this.changing = true;
    void this.switchProvider(provider).then(resolve, reject);
    this.notify();
    return operation;
  };

  private async switchProvider(provider: DemoVoiceProvider) {
    const selection = voiceProviderStore.state;
    try {
      await this.disconnect();
      if (this.retired || voiceProviderStore.state !== selection) return;
      const providerInstanceId = crypto.randomUUID();
      const adapter = this.factory(provider, this.memory.sessionId);
      let session: RealtimeSession;
      try {
        session = this.createSession(adapter, provider, providerInstanceId);
      } catch (error) {
        await adapter.disconnect();
        throw error;
      }
      if (this.retired || voiceProviderStore.state !== selection) {
        await session.disconnect();
        return;
      }
      if (this.memory.getSnapshot().introductionAttempted)
        this.coordinator.skip(this.memory.sessionId);
      for (const release of this.releases) release();
      this.provider = provider;
      this.providerInstanceId = providerInstanceId;
      this.adapter = adapter;
      this.session = session;
      this.userTranscript = undefined;
      this.assistantTranscript = undefined;
      this.observe();
      selectVoiceProvider(provider);
    } finally {
      this.switching = undefined;
      this.changing = false;
      this.notify();
    }
  }

  retain() {
    this.consumers++;
    this.retired = false;
    return () => {
      this.consumers--;
      if (this.consumers !== 0) return;
      this.retired = true;
      queueMicrotask(() => {
        if (this.retired) void this.disconnect().catch(() => {});
      });
    };
  }

  read(): UseVoiceResult & {
    owner: DemoVoiceOwner;
    provider: DemoVoiceProvider;
    switching: boolean;
  } {
    const session = this.session;
    return {
      owner: this,
      provider: this.provider,
      switching: this.changing || this.ending,
      session,
      state: session.state,
      error: session.lastError,
      greetingState: session.greetingState,
      userTranscript: this.userTranscript,
      assistantTranscript: this.assistantTranscript,
      turnMode: session.turnMode,
      turnModeError: session.turnModeError,
      turnControl: session.turnControl,
      connect: this.connect,
      disconnect: this.disconnect,
      skipGreeting: this.skipGreeting,
    };
  }
}

export function demoVoice(factory: Factory, greeting: string) {
  const owners = new WeakMap<Orchestrator, DemoVoiceOwner>();
  return (context: MaelstromExtensionContext) => {
    function useOwner() {
      const { orchestrator } = context.useMaelstromContext();
      let owner = owners.get(orchestrator);
      if (!owner) {
        owner = new DemoVoiceOwner(orchestrator, factory, greeting);
        owners.set(orchestrator, owner);
      }
      const current = owner;
      useSyncExternalStore(
        current.subscribe,
        current.getSnapshot,
        current.getSnapshot,
      );
      useEffect(() => current.retain(), [current]);
      return current;
    }
    function useVoice() {
      return useOwner().read();
    }
    function useVoiceObservations() {
      const owner = useOwner();
      const source = owner.session.observations;
      const snapshot = useSyncExternalStore(
        source.subscribe,
        source.getSnapshot,
        source.getSnapshot,
      );
      return { snapshot, session: owner.session };
    }
    function VoiceOrb({ size = 44, className }: VoiceOrbProps) {
      const voice = useVoice();
      const active = voice.state !== 'idle' && voice.state !== 'error';
      return (
        <button
          type="button"
          className={`rounded-full bg-brand text-bg-0 flex items-center justify-center ${className ?? ''}`}
          style={{ width: size, height: size }}
          disabled={voice.switching}
          aria-label={active ? 'End voice' : 'Start voice'}
          data-state={voice.state}
          onClick={() => {
            void (active ? voice.disconnect() : voice.connect()).catch(
              () => {},
            );
          }}
        >
          {active ? <Square size={18} /> : <Mic size={18} />}
        </button>
      );
    }
    return { useVoice, useVoiceObservations, VoiceOrb };
  };
}
