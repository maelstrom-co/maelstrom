// getContainer() from @cloudflare/containers defaults to one fixed instance
// id when none is given, so every visitor lands on the same Durable Object
// and `max_instances` in wrangler.jsonc goes unused. Hashing the session
// into a fixed number of buckets keeps a given session pinned to the same
// container across reconnects while spreading visitors across every
// provisioned instance.
export const SHARDS = 5; // must match containers[0].max_instances in wrangler.jsonc

// FNV-1a: cheap, dependency-free, and stable across runs -- nothing here
// needs to be cryptographically unpredictable, just consistent.
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Durable Object instance name `getContainer()` should route `session` to.
 * `session` may be `''` (a keyless visitor's first frames arrive before any
 * `playground.hello`, so the /ws URL may carry no `session` param yet) --
 * fnv1a('') is a fixed, valid bucket, so this never throws and still routes
 * deterministically.
 */
export function shardInstanceName(session: string): string {
  return `shard-${fnv1a(session) % SHARDS}`;
}
