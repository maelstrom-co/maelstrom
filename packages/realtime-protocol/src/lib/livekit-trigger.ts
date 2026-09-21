/** Explicit-dispatch registration for trigger sessions; not an authentication proof. */
export const TRIGGER_AGENT_NAME = 'maelstrom-trigger-v1';

/** Server-generated bootstrap binding, delivered over the trusted mint transport and job metadata. */
export interface LiveKitTriggerBinding {
  /** Metadata contract version. */
  readonly version: 1;
  /** Fresh effective room for this bootstrap; SDK reconnects retain it. */
  readonly roomName: string;
  /** Browser identity authorized by the mint endpoint. */
  readonly browserIdentity: string;
  /** Random server-chosen worker identity; never chosen by a room participant. */
  readonly workerIdentity: string;
  /** Unix seconds deadline for admitting a new job, not an active-session duration limit. */
  readonly expiresAt: number;
}

/** Validates bounded bootstrap fields without dependencies; admission must additionally check expiry. */
export function isLiveKitTriggerBinding(
  value: unknown,
): value is LiveKitTriggerBinding {
  if (typeof value !== 'object' || value === null) return false;
  if (!('version' in value) || value.version !== 1) return false;
  for (const key of [
    'roomName',
    'browserIdentity',
    'workerIdentity',
  ] as const) {
    if (!(key in value)) return false;
    const field = Reflect.get(value, key);
    if (
      typeof field !== 'string' ||
      field.trim().length === 0 ||
      field.length > 512
    )
      return false;
  }
  return (
    'expiresAt' in value &&
    typeof value.expiresAt === 'number' &&
    Number.isSafeInteger(value.expiresAt) &&
    value.expiresAt > 0
  );
}

/** Parses bounded dispatch metadata; malformed or expired metadata never falls back to normal mode. */
export function parseLiveKitTriggerBinding(
  metadata: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): LiveKitTriggerBinding | undefined {
  if (metadata.length > 4096) return undefined;
  try {
    const value: unknown = JSON.parse(metadata);
    return isLiveKitTriggerBinding(value) && value.expiresAt > nowSeconds
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
