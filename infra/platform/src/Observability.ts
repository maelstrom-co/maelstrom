/** Worker telemetry policy retained until a measured sampling budget replaces it. */
export const workerObservability = {
  /** Keep deployment and runtime failures visible in the Cloudflare dashboard. */
  enabled: true,
  /** Preserve low-volume waitlist evidence while its baseline is established. */
  headSamplingRate: 1,
  /** Searchable log settings used during incident response. */
  logs: {
    /** Keep structured application failures queryable. */
    enabled: true,
    /** Avoid sampling away rare delivery-state failures before baselining. */
    headSamplingRate: 1,
    /** Retain request metadata for route-level failure correlation. */
    invocationLogs: true,
    /** Make logs available after the real-time tail disconnects. */
    persist: true,
  },
} as const;

/**
 * Worker telemetry policy for sites that do not emit traces.
 *
 * Same log posture as {@link workerObservability}; only the trace surface
 * differs.
 */
export const workerObservabilityNoTraces = {
  ...workerObservability,
  traces: {
    enabled: false,
  },
} as const;
