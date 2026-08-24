export const REQUIRED_WORKER_BINDINGS = [
  'SESSION_DO',
  'WS_RATE_LIMITER',
] as const;

export type RequiredWorkerBinding = (typeof REQUIRED_WORKER_BINDINGS)[number];
