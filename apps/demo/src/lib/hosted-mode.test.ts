import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isHosted,
  usesBrowserKey,
  usesBrowserOpenAIVoice,
  usesOpenAIVoice,
} from './hosted-mode';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isHosted', () => {
  it('is false when VITE_HOSTED is unset', () => {
    vi.stubEnv('VITE_HOSTED', undefined);
    expect(isHosted()).toBe(false);
  });

  it('is true when VITE_HOSTED is exactly "1"', () => {
    vi.stubEnv('VITE_HOSTED', '1');
    expect(isHosted()).toBe(true);
  });

  it('is false for any other value', () => {
    vi.stubEnv('VITE_HOSTED', 'true');
    expect(isHosted()).toBe(false);
  });
});

describe('usesBrowserKey', () => {
  it('is true for hosted deployments', () => {
    vi.stubEnv('VITE_HOSTED', '1');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    vi.stubEnv('MAELSTROM_PLANNER', 'jev');
    expect(usesBrowserKey()).toBe(true);
  });

  it('is true on localhost when the server has no OpenAI key', () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    expect(usesBrowserKey()).toBe(true);
  });

  it('is false on localhost when the server owns an OpenAI key', () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    expect(usesBrowserKey()).toBe(false);
  });

  it('uses server custody in the local Jev profile without a browser OpenAI voice key', () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    vi.stubEnv('OPENAI_API_KEY', undefined);
    expect(usesBrowserKey()).toBe(false);
    expect(usesBrowserOpenAIVoice()).toBe(false);
  });
});

describe('usesBrowserOpenAIVoice', () => {
  it('is true for OpenAI voice in browser-key mode', () => {
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    vi.stubEnv('VITE_VOICE_PROVIDER', 'openai');
    expect(usesBrowserOpenAIVoice()).toBe(true);
  });

  it('is false for LiveKit even when text uses a browser key', () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    vi.stubEnv('VITE_VOICE_PROVIDER', 'livekit');
    expect(usesBrowserOpenAIVoice()).toBe(false);
  });

  it('ignores an unsupported hosted LiveKit setting consistently', () => {
    vi.stubEnv('VITE_HOSTED', '1');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    vi.stubEnv('VITE_VOICE_PROVIDER', 'livekit');

    expect(usesOpenAIVoice()).toBe(true);
    expect(usesBrowserOpenAIVoice()).toBe(true);
  });
});
