/**
 * Type-only public API contract checks.
 *
 * This file is intentionally never used at runtime. The value references and
 * `void` expressions keep the compiler checking the public surface in both lib
 * and spec builds so accidental API widening fails CI.
 */
import {
  createSTT,
  createTTS,
  type STTProvider,
  type TTSProvider,
} from '@maelstrom-co/voice-server';
import type {
  BaseSTTOptions,
  BaseTTSOptions,
  STTProviderConfig,
  STTProviderType,
  TTSProviderConfig,
  TTSProviderType,
} from '@maelstrom-co/voice-server';

/** Pin the exported registry unions to the intended built-in provider set. */
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

  void invalidSttDiscriminant;
  void additiveSttDiscriminant;
  void missingGoogleProjectId;
  void invalidTtsDiscriminant;
  void additiveTtsDiscriminant;
  void sttExhaustive;
  void ttsExhaustive;
}

/** Pin the root constructors to stable callable signatures. */
function assertRootFactoryExports(): void {
  const sttFactory: (config: STTProviderConfig) => STTProvider = createSTT;
  const ttsFactory: (config: TTSProviderConfig) => TTSProvider = createTTS;

  void sttFactory;
  void ttsFactory;
}

assertRegistryContracts();
assertRootFactoryExports();
