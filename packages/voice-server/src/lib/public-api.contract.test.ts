/**
 * Type-level public API contract checks for the published voice-server package.
 *
 * This file is a real Bun test so CI surfaces contract drift as a failing test,
 * while the body stays focused on compile-time guarantees rather than runtime behavior.
 */
import { test } from 'bun:test';
import { SessionId } from '@maelstrom-co/protocol';
import {
  createSTT,
  createTTS,
  type BaseSTTOptions,
  type BaseTTSOptions,
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
  type VoiceSessionCallbacks,
  type VoiceSessionAudioDroppedEvent,
  type VoiceSessionAudioDropReason,
  type VoiceSessionConfig,
  type VoiceSessionError,
} from '@maelstrom-co/voice-server';

test('public API contract is locked', () => {
  const sessionId = SessionId('contract-session');
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
    audioBufferMaxMs: 1_000,
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

  const legacyVoiceSessionConfig = {
    stt,
    tts,
    sessionId,
    // @ts-expect-error `maxPendingAudioChunks` was removed from the public config contract.
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

    // @ts-expect-error STT error kinds must stay a closed discriminated union.
    const invalidSttErrorKind: STTError = Object.assign(new Error('bad'), {
      source: 'stt' as const,
      provider: 'deepgram',
      kind: 'bad_kind',
    });

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
    void invalidSttErrorKind;
    void invalidTtsErrorSource;
  }

  function assertRootFactoryExports(): void {
    const sttFactory: (config: STTProviderConfig) => STTProvider = createSTT;
    const ttsFactory: (config: TTSProviderConfig) => TTSProvider = createTTS;

    void sttFactory;
    void ttsFactory;
  }

  assertRegistryContracts();
  assertRootFactoryExports();
});
