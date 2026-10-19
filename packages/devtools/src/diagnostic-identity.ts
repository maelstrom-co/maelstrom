export type IdentityAvailability =
  | 'reported'
  | 'not-reported'
  | 'redacted'
  | 'truncated'
  | 'unreadable';

const markers = [
  { name: 'REDACTED', reason: 'redacted' },
  { name: 'TRUNCATED', reason: 'truncated' },
  { name: 'CIRCULAR', reason: 'unreadable' },
  { name: 'MAX_DEPTH', reason: 'unreadable' },
] as const;

export function identityAvailability(value: unknown): IdentityAvailability {
  if (value === undefined || value === null || value === '')
    return 'not-reported';
  if (typeof value !== 'string') return 'unreadable';
  const complete = /\[(REDACTED|TRUNCATED|CIRCULAR|MAX_DEPTH)[^\]]*\]/.exec(
    value,
  )?.[1];
  const bracket = value.lastIndexOf('[');
  const tail = bracket < 0 ? undefined : value.slice(bracket);
  const marker = markers.find(({ name }) =>
    complete
      ? name === complete
      : tail !== undefined && `[${name}]`.startsWith(tail),
  );
  return marker?.reason ?? 'reported';
}

export function identity(value: unknown): string | undefined {
  return typeof value === 'string' && identityAvailability(value) === 'reported'
    ? value
    : undefined;
}

export function eventIdentity(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const raw = value as Record<string, unknown>;
  return identity(raw.entryId) ?? identity(raw.id);
}
