/**
 * Type-level public API contract checks for the published voice-server package.
 *
 * This file is a real Bun test so CI surfaces contract drift as a failing test,
 * while the body stays focused on compile-time guarantees rather than runtime behavior.
 */
import { expect, test } from 'bun:test';
import { SessionId } from '@maelstrom-co/protocol';
import * as voiceServer from '@maelstrom-co/voice-server';
import {
  type BaseSTTOptions,
  type BaseTTSOptions,
  createSTT,
  createTTS,
  type SpeechStart,
  type STTError,
  type STTEvent,
  type STTProvider,
  type STTProviderConfig,
  type STTProviderType,
  type TTSError,
  type TTSEvent,
  type TTSProvider,
  type TTSProviderConfig,
  type TTSProviderType,
  type VoiceProviderErrorKind,
  type VoiceSession,
  type VoiceSessionAudioDroppedEvent,
  type VoiceSessionAudioDropReason,
  type VoiceSessionCallbacks,
  type VoiceSessionConfig,
  type VoiceSessionError,
} from '@maelstrom-co/voice-server';

test('public API contract is locked', () => {
  const sessionId = SessionId('contract-session');
  const explicitAudioBufferMaxMs = 1_000;
  const stt: VoiceSessionConfig['stt'] = {
    type: 'deepgram',
    options: { apiKey: 'deepgram-key' },
  };
  const tts: VoiceSessionConfig['tts'] = {
    type: 'cartesia',
    options: { apiKey: 'cartesia-key', defaultVoiceId: 'voice-123' },
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
    audioBufferMaxMs: explicitAudioBufferMaxMs,
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
  };

  const narrowedProviderTag = narrowVoiceSessionProviderTag(sttError);
  const narrowedGenericTag = narrowVoiceSessionProviderTag(
    new Error('generic runtime'),
  );
  const resolverDefaults = {
    vadFinalDebounceMs: 150,
    audioBufferMaxMs: 1_500,
    maxReconnectAttempts: 2,
    reconnectDelayMs: 250,
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
  void runtimeErrorCallback;
  void voiceProviderErrorKind;
  void speechStart;
  void narrowedProviderTag;
  void narrowedGenericTag;
  void legacyVoiceSessionConfig;

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
    const provisionResolver: typeof voiceServer.resolveVoiceProvisionConfig =
      voiceServer.resolveVoiceProvisionConfig;
    const providerDrivenInterimResults = createSTT(publicVoiceSessionConfig.stt)
      .capabilities.interimTranscripts;
    const resolvedSessionConfig = sessionResolver(
      publicVoiceSessionConfig,
      resolverDefaults,
    );
    const resolvedProvisionConfig = provisionResolver(
      publicVoiceSessionConfig,
      resolverDefaults,
    );

    expect(sessionResolver).toBe(provisionResolver);
    expect(resolvedSessionConfig.interimResults).toBe(
      providerDrivenInterimResults,
    );
    expect(resolvedSessionConfig.intentBoundary).toBeNull();
    expect(resolvedSessionConfig.audioBufferMaxMs).toBe(
      explicitAudioBufferMaxMs,
    );
    expect(resolvedProvisionConfig.interimResults).toBe(
      resolvedSessionConfig.interimResults,
    );
    expect(resolvedProvisionConfig.intentBoundary).toBe(
      resolvedSessionConfig.intentBoundary,
    );
    expect(resolvedProvisionConfig.audioBufferMaxMs).toBe(
      resolvedSessionConfig.audioBufferMaxMs,
    );
    expect(resolvedProvisionConfig.maxReconnectAttempts).toBe(
      resolvedSessionConfig.maxReconnectAttempts,
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
