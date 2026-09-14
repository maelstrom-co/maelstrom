import { createHash, timingSafeEqual } from 'node:crypto';

export interface LocalLiveAccessOptions {
  readonly enabled: boolean;
  readonly hosted: boolean;
  readonly password?: string;
}

export interface LocalRequestPeer {
  readonly localAddress?: string;
  readonly remoteAddress?: string;
}

export function isLoopback(address: string | undefined): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

export function createLocalLiveAccess(options: LocalLiveAccessOptions) {
  if (!options.enabled || options.hosted) return () => false;
  if (!options.password || options.password.length < 24)
    throw new Error(
      'DEMO_LOCAL_PASSWORD must contain at least 24 characters for local server-key mode',
    );
  const expected = createHash('sha256')
    .update(
      `Basic ${Buffer.from(`maelstrom:${options.password}`).toString('base64')}`,
    )
    .digest();
  return (headers: Headers, peer: LocalRequestPeer): boolean => {
    if (!isLoopback(peer.localAddress) || !isLoopback(peer.remoteAddress))
      return false;
    const authorization = headers.get('authorization');
    if (!authorization || authorization.length > 2048) return false;
    const actual = createHash('sha256').update(authorization).digest();
    return timingSafeEqual(expected, actual);
  };
}
