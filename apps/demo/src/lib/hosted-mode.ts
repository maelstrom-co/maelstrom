// The single build-time switch between the hosted BYOK playground (Cloudflare
// Worker + Container, same-origin WS, visitor-supplied key) and local dev
// (shared engine keyed by server env vars). Centralized so every call site
// reads the same flag the same way.
export function isHosted(): boolean {
  return import.meta.env.VITE_HOSTED === '1';
}
