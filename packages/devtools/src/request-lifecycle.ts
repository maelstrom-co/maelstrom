export type RequestStatus =
  | 'awaiting'
  | 'received'
  | 'applied'
  | 'applied-with-issues'
  | 'failed'
  | 'cancelled'
  | 'discarded'
  | 'abandoned';

const terminalStatuses: Readonly<Record<string, RequestStatus>> = {
  'client.response.applied': 'applied',
  'client.response.failed': 'failed',
  'client.request.failed': 'failed',
  'client.response.discarded': 'discarded',
  'client.response.abandoned': 'abandoned',
};

export function requestTerminalStatus(kind: string): RequestStatus | undefined {
  return Object.hasOwn(terminalStatuses, kind)
    ? terminalStatuses[kind]
    : undefined;
}

export function responseSource(
  kind: string,
  source: unknown,
): 'request' | 'push' | undefined {
  if (source !== 'request' && source !== 'push') return undefined;
  return kind === 'client.response.received' ||
    (kind.startsWith('client.response.') &&
      requestTerminalStatus(kind) !== undefined)
    ? source
    : undefined;
}
