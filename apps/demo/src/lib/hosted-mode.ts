// The single build-time switch between the hosted BYOK playground (Cloudflare
// Worker + one Durable Object per session, same-origin WS, visitor-supplied
// key) and local dev (shared engine keyed by server env vars). Centralized so
// every call site reads the same flag the same way.
export function isHosted(): boolean {
  return import.meta.env.VITE_HOSTED === '1';
}

/**
 * Whether this browser supplies the OpenAI key. Hosted deployments always do;
 * local development falls back only when Vite found no server-side key.
 */
export function usesBrowserKey(): boolean {
  return isHosted() || import.meta.env.VITE_BROWSER_KEY_MODE === '1';
}

/** Whether OpenAI voice, rather than LiveKit, uses the browser-owned key. */
export function usesBrowserOpenAIVoice(): boolean {
  return usesBrowserKey() && usesOpenAIVoice();
}

/** Hosted BYOK always uses OpenAI; LiveKit is available only to local profiles. */
export function usesOpenAIVoice(): boolean {
  return isHosted() || import.meta.env.VITE_VOICE_PROVIDER !== 'livekit';
}
