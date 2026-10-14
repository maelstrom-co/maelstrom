export const telemetryOperations = [
  'client.request',
  'client.apply',
  'client.action',
  'engine.plan',
  'engine.stage',
  'voice.tool',
] as const;
export const telemetryOutcomes = [
  'started',
  'succeeded',
  'succeeded_with_issues',
  'failed',
  'cancelled',
  'discarded',
  'skipped',
  'unknown',
] as const;
export const telemetryProviders = [
  'openai-live',
  'openai-realtime',
  'livekit',
  'custom',
] as const;
export const telemetryErrorCategories = [
  'transport',
  'validation',
  'timeout',
  'readiness',
  'application',
  'provider',
  'unknown',
] as const;
export const telemetryLayoutModes = ['grid', 'tiling'] as const;
