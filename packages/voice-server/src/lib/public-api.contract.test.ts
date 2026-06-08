/**
 * Type-level public API contract checks for the published voice-server package.
 *
 * This file is a real Bun test so CI surfaces contract drift as a failing test,
 * while the body stays focused on compile-time guarantees rather than runtime behavior.
 */
import { expect, test } from 'bun:test';
import { SessionId } from '@maelstrom-co/protocol';
import type { TelemetrySink } from '@maelstrom-co/telemetry';
import * as voiceServer from '@maelstrom-co/voice-server';
import {
  type BaseSTTOptions,
  type BaseTTSOptions,
  createSTT,
  createTTS,
  isVoiceSessionQueuedTurnsDroppedError,
  type SpeechStart,
  type SpeechStopReason,
  type SpeechSynthesisHandle,
  type STTError,
  type STTEvent,
  type STTProvider,
  type STTProviderConfig,
  type STTProviderType,
  type SttCircuitStatus,
  type TTSError,
  type TTSEvent,
  type TTSProvider,
  type TTSProviderConfig,
  type TTSProviderType,
  type VoiceDisconnectedEvent,
  type VoiceDisconnectReason,
  type VoiceProviderErrorKind,
  type VoiceSession,
  type VoiceSessionAudioDroppedEvent,
  type VoiceSessionAudioDropReason,
  type VoiceSessionCallbacks,
  type VoiceSessionConfig,
  type VoiceSessionError,
  type VoiceSessionQueuedTurnsDroppedError,
} from '@maelstrom-co/voice-server';

type Equal<Left, Right> = ((<Value>() => Value extends Left ? 1 : 2) extends <
  Value,
>() => Value extends Right ? 1 : 2
  ? true
  : false) &
  ((<Value>() => Value extends Right ? 1 : 2) extends <
    Value,
  >() => Value extends Left ? 1 : 2
    ? true
    : false);

type Expect<Value extends true> = Value;

test('public API contract is locked', () => {
  const sessionId = SessionId('contract-session');
  const explicitAudioBufferMaxMs = 1_000;
  const explicitTranscriptGraceMs = 1_500;
  const stt: VoiceSessionConfig['stt'] = {
    type: 'deepgram',
    options: { apiKey: 'deepgram-key' },
  };
  const tts: VoiceSessionConfig['tts'] = {
    type: 'cartesia',
    options: { apiKey: 'cartesia-key', defaultVoiceId: 'voice-123' },
  };
  const telemetry: NonNullable<VoiceSessionConfig['telemetry']> = {
    emitEvent() {},
    recordMetric() {},
    recordTiming() {},
  };

  const audioDropReason: VoiceSessionAudioDropReason = 'state_not_listening';

  const audioDroppedEvent: VoiceSessionAudioDroppedEvent = {
    type: 'audio_dropped',
    reason: audioDropReason,
    droppedDurationMs: 250,
  };

  const publicVoiceSessionConfig: VoiceSessionConfig = {
    stt,
    tts,
    sessionId,
    transcriptGraceMs: explicitTranscriptGraceMs,
    audioBufferMaxMs: explicitAudioBufferMaxMs,
    telemetry,
  };

  type OnAudioDroppedIsOptional =
    undefined extends VoiceSession['onAudioDropped'] ? true : false;
  const onAudioDroppedIsOptional: OnAudioDroppedIsOptional = false;
  const onAudioDroppedCallback: NonNullable<
    VoiceSessionCallbacks['onAudioDropped']
  > = (event) => {
    void event;
  };
  const sttError: STTError = Object.assign(new Error('stt transport'), {
    source: 'stt' as const,
    provider: 'deepgram',
    kind: 'transport' as const,
  });
  const ttsError: TTSError = Object.assign(new Error('tts auth'), {
    source: 'tts' as const,
    provider: 'cartesia',
    kind: 'auth' as const,
  });
  const sttErrorEvent: STTEvent = { type: 'error', error: sttError };
  const ttsErrorEvent: TTSEvent = { type: 'error', error: ttsError };
  const sttDisconnectedEvent: STTEvent = {
    type: 'disconnected',
    clean: true,
    reason: 'clean_shutdown',
    message: 'socket closed cleanly',
  };
  const ttsDisconnectedEvent: TTSEvent = {
    type: 'disconnected',
    clean: false,
    reason: 'transport_lost',
    message: 'transport lost',
  };
  const voiceDisconnectReason: VoiceDisconnectReason = 'idle_timeout';
  const voiceDisconnectedEvent: VoiceDisconnectedEvent = {
    type: 'disconnected',
    clean: true,
    reason: voiceDisconnectReason,
    message: 'provider closed after idle timeout',
  };
  const runtimeErrorCallback: NonNullable<VoiceSessionCallbacks['onError']> = (
    error: VoiceSessionError,
  ) => {
    void error;
  };
  const voiceProviderErrorKind: VoiceProviderErrorKind = 'quota';
  const speechStart: SpeechStart = {
    text: 'hello world',
    format: 'mp3',
    sampleRate: 24_000,
    queued: false,
  };
  const speechStopReason: SpeechStopReason = 'completed';
  const speechHandle: SpeechSynthesisHandle = {
    speech: speechStart,
    completion: Promise.resolve(speechStopReason),
  };
  const sttCircuitStatus: SttCircuitStatus = 'half_open';
  const getSttCircuitStatus: VoiceSession['getSttCircuitStatus'] = () =>
    sttCircuitStatus;
  const onSttCircuitStatusChange: VoiceSession['onSttCircuitStatusChange'] = (
    callback,
  ) => {
    callback(sttCircuitStatus);
    return () => {};
  };
  const replayedCircuitStatuses: SttCircuitStatus[] = [];

  const narrowedProviderTag = narrowVoiceSessionProviderTag(sttError);
  const narrowedGenericTag = narrowVoiceSessionProviderTag(
    new Error('generic runtime'),
  );
  const resolverDefaults: Parameters<
    typeof voiceServer.resolveVoiceSessionConfig
  >[1] = {
    vadFinalDebounceMs: 150,
    transcriptGraceMs: 1_500,
    audioBufferMaxMs: 1_500,
    maxReconnectAttempts: 2,
    reconnectDelayMs: 250,
    maxReconnectDelayMs: 1_000,
    reconnectBackoffMultiplier: 2,
    reconnectJitterMs: 125,
    circuitBreakerTimeoutMs: 5_000,
  };

  const legacyVoiceSessionConfig = {
    stt,
    tts,
    sessionId,
    // @ts-expect-error `maxPendingAudioChunks` is not part of the public config contract.
    maxPendingAudioChunks: 4,
  } satisfies VoiceSessionConfig;

  void audioDroppedEvent;
  void publicVoiceSessionConfig;
  void onAudioDroppedIsOptional;
  void onAudioDroppedCallback;
  void sttErrorEvent;
  void ttsErrorEvent;
  void sttDisconnectedEvent;
  void ttsDisconnectedEvent;
  void runtimeErrorCallback;
  void voiceProviderErrorKind;
  void speechStart;
  void speechStopReason;
  void speechHandle;
  void voiceDisconnectReason;
  void voiceDisconnectedEvent;
  void sttCircuitStatus;
  void getSttCircuitStatus;
  void narrowedProviderTag;
  void narrowedGenericTag;
  void legacyVoiceSessionConfig;

  type PublicConfigIncludesTranscriptGraceMs =
    'transcriptGraceMs' extends keyof VoiceSessionConfig ? true : false;
  type ResolvedConfigIncludesTranscriptGraceMs =
    'transcriptGraceMs' extends keyof ReturnType<
      typeof voiceServer.resolveVoiceSessionConfig
    >
      ? true
      : false;
  type _AssertTelemetryConfigType = Expect<
    Equal<VoiceSessionConfig['telemetry'], TelemetrySink | undefined>
  >;
  type _AssertEnqueueSpeak = Expect<
    Equal<VoiceSession['enqueueSpeak'], (text: string, voice?: string) => void>
  >;
  type _AssertQueuedTurnsDroppedTypeGuard = Expect<
    Equal<
      typeof isVoiceSessionQueuedTurnsDroppedError,
      (error: unknown) => error is VoiceSessionQueuedTurnsDroppedError
    >
  >;

  const publicConfigIncludesTranscriptGraceMs: PublicConfigIncludesTranscriptGraceMs = true;
  const resolvedConfigIncludesTranscriptGraceMs: ResolvedConfigIncludesTranscriptGraceMs = true;
  const queuedTurnsDroppedError = Object.assign(
    new Error('dropped queued turns'),
    {
      droppedQueueCount: 2,
    },
  ) as VoiceSessionQueuedTurnsDroppedError;

  void publicConfigIncludesTranscriptGraceMs;
  void resolvedConfigIncludesTranscriptGraceMs;
  void telemetry;
  void (0 as unknown as _AssertTelemetryConfigType);
  void (0 as unknown as _AssertEnqueueSpeak);
  void (0 as unknown as _AssertQueuedTurnsDroppedTypeGuard);

  expect('TelemetrySink' in voiceServer).toBe(false);

  onSttCircuitStatusChange((status) => {
    replayedCircuitStatuses.push(status);
  });
  expect(replayedCircuitStatuses).toEqual(['half_open']);
  expect(isVoiceSessionQueuedTurnsDroppedError(queuedTurnsDroppedError)).toBe(
    true,
  );
  expect(
    isVoiceSessionQueuedTurnsDroppedError(new Error('generic runtime')),
  ).toBe(false);

  function assertRegistryContracts(): void {
    const sttType: STTProviderType = 'google';
    const ttsType: TTSProviderType = 'cartesia';

    const sharedSttOptions: BaseSTTOptions = {
      interimResults: true,
    };
    const sharedTtsOptions: BaseTTSOptions = {
      language: 'en-US',
      sampleRate: 24000,
    };

    const validSttConfigs = [
      {
        type: 'deepgram',
        options: {
          ...sharedSttOptions,
          apiKey: 'deepgram-key',
        },
      },
      {
        type: 'google',
        options: {
          ...sharedSttOptions,
          projectId: 'project-123',
          language: 'en-US',
          credentialsJSON: '{"client_email":"bot@example.com"}',
        },
      },
    ] satisfies STTProviderConfig[];

    const validTtsConfigs = [
      {
        type: 'cartesia',
        options: {
          ...sharedTtsOptions,
          apiKey: 'cartesia-key',
          defaultVoiceId: 'voice-123',
        },
      },
      {
        type: 'google',
        options: {
          ...sharedTtsOptions,
          defaultVoiceName: 'en-US-Chirp3-HD-Achernar',
        },
      },
    ] satisfies TTSProviderConfig[];

    void sttType;
    void ttsType;
    void validSttConfigs;
    void validTtsConfigs;

    const invalidSttDiscriminant: STTProviderConfig = {
      // @ts-expect-error The public registry contract must reject misspelled STT discriminants.
      type: 'deepgramm',
      options: {
        ...sharedSttOptions,
        apiKey: 'deepgram-key',
      },
    };

    const additiveSttDiscriminant: STTProviderConfig = {
      // @ts-expect-error Public STT unions must reject unregistered provider additions.
      type: 'whisper',
      options: {
        ...sharedSttOptions,
        apiKey: 'deepgram-key',
      },
    };

    // @ts-expect-error Google STT must keep projectId required through the discriminated union.
    const missingGoogleProjectId: STTProviderConfig = {
      type: 'google',
      options: {
        ...sharedSttOptions,
        credentialsJSON: '{"client_email":"bot@example.com"}',
      },
    };

    const invalidTtsDiscriminant: TTSProviderConfig = {
      // @ts-expect-error The public registry contract must reject misspelled TTS discriminants.
      type: 'googl',
      options: {
        ...sharedTtsOptions,
        defaultVoiceName: 'en-US-Chirp3-HD-Achernar',
      },
    };

    const additiveTtsDiscriminant: TTSProviderConfig = {
      // @ts-expect-error Public TTS unions must reject unregistered provider additions.
      type: 'whisper',
      options: {
        ...sharedTtsOptions,
        defaultVoiceName: 'en-US-Chirp3-HD-Achernar',
      },
    };

    type SttExhaustive =
      Exclude<STTProviderType, 'deepgram' | 'google'> extends never
        ? true
        : false;
    type TtsExhaustive =
      Exclude<TTSProviderType, 'cartesia' | 'google'> extends never
        ? true
        : false;
    const sttExhaustive: SttExhaustive = true;
    const ttsExhaustive: TtsExhaustive = true;

    // @ts-expect-error Public drop reasons must stay a closed string-literal union.
    const invalidDropReason: VoiceSessionAudioDropReason = 'unknown_reason';

    // @ts-expect-error Provider error kinds must stay a closed string-literal union.
    const invalidVoiceProviderErrorKind: VoiceProviderErrorKind = 'bad_kind';

    // @ts-expect-error STT circuit status must stay a closed string-literal union.
    const invalidSttCircuitStatus: SttCircuitStatus = 'degraded';

    // @ts-expect-error Removed STT connected events must not remain in the public contract.
    const removedSttConnectedEvent: STTEvent = { type: 'connected' };

    // @ts-expect-error Disconnected STT events now require clean/message payloads.
    const invalidSttDisconnectedEvent: STTEvent = { type: 'disconnected' };

    const contradictorySttDisconnectedEvent: STTEvent = {
      type: 'disconnected',
      clean: true,
      // @ts-expect-error Clean disconnects cannot use the transport_lost reason.
      reason: 'transport_lost',
      message: 'contradictory clean disconnect',
    };

    const removedTtsStartedEvent: TTSEvent = {
      // @ts-expect-error Removed TTS started events must not remain in the public contract.
      type: 'started',
      speech: speechStart,
    };

    // @ts-expect-error Removed TTS completed events must not remain in the public contract.
    const removedTtsCompletedEvent: TTSEvent = { type: 'completed' };

    // @ts-expect-error Removed TTS stopped events must not remain in the public contract.
    const removedTtsStoppedEvent: TTSEvent = { type: 'stopped' };

    // @ts-expect-error Disconnected TTS events now require clean/message payloads.
    const invalidTtsDisconnectedEvent: TTSEvent = { type: 'disconnected' };

    const contradictoryTtsDisconnectedEvent: TTSEvent = {
      type: 'disconnected',
      clean: false,
      // @ts-expect-error Unclean disconnects cannot use clean-only reasons.
      reason: 'idle_timeout',
      message: 'contradictory unclean disconnect',
    };

    // @ts-expect-error TTSError must keep the `tts` source discriminant.
    const invalidTtsErrorSource: TTSError = Object.assign(new Error('bad'), {
      source: 'stt' as const,
      provider: 'cartesia',
      kind: 'transport' as const,
    });

    void invalidSttDiscriminant;
    void additiveSttDiscriminant;
    void missingGoogleProjectId;
    void invalidTtsDiscriminant;
    void additiveTtsDiscriminant;
    void sttExhaustive;
    void ttsExhaustive;
    void invalidDropReason;
    void invalidVoiceProviderErrorKind;
    void invalidSttCircuitStatus;
    void removedSttConnectedEvent;
    void invalidSttDisconnectedEvent;
    void contradictorySttDisconnectedEvent;
    void removedTtsStartedEvent;
    void removedTtsCompletedEvent;
    void removedTtsStoppedEvent;
    void invalidTtsDisconnectedEvent;
    void contradictoryTtsDisconnectedEvent;
    void invalidTtsErrorSource;
  }

  function assertRootFactoryExports(): void {
    const sttFactory: (config: STTProviderConfig) => STTProvider = createSTT;
    const ttsFactory: (config: TTSProviderConfig) => TTSProvider = createTTS;

    void sttFactory;
    void ttsFactory;
  }

  function assertRootResolverExports(): void {
    const sessionResolver: typeof voiceServer.resolveVoiceSessionConfig =
      voiceServer.resolveVoiceSessionConfig;
    const providerDrivenInterimResults = createSTT(publicVoiceSessionConfig.stt)
      .capabilities.interimTranscripts;
    const resolvedSessionConfig = sessionResolver(
      publicVoiceSessionConfig,
      resolverDefaults,
    );

    expect(resolvedSessionConfig.interimResults).toBe(
      providerDrivenInterimResults,
    );
    expect(resolvedSessionConfig.intentBoundary).toBeNull();
    expect(resolvedSessionConfig.transcriptGraceMs).toBe(
      explicitTranscriptGraceMs,
    );
    expect(resolvedSessionConfig.audioBufferMaxMs).toBe(
      explicitAudioBufferMaxMs,
    );
  }

  function assertNarrowingHelperRuntime(): void {
    expect(narrowedProviderTag).toBe('provider:stt:transport');
    expect(narrowedGenericTag).toBe('generic');
  }

  assertRegistryContracts();
  assertRootFactoryExports();
  assertRootResolverExports();
  assertNarrowingHelperRuntime();

  function narrowVoiceSessionProviderTag(
    error: VoiceSessionError,
  ):
    | `provider:${STTError['source'] | TTSError['source']}:${VoiceProviderErrorKind}`
    | 'generic' {
    if ('source' in error && 'kind' in error && 'provider' in error) {
      return `provider:${error.source}:${error.kind}`;
    }

    return 'generic';
  }
});
