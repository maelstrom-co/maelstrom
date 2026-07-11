// Shared between the hosted-mode browser-direct mint (maelstrom.ts) and the
// local-mode server route's env fallback (routes/api/realtime-token.ts) so
// both modes mint the same model without duplicating the literal.
export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2';
