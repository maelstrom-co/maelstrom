import * as Alchemy from 'alchemy';

/** Public values emitted after the retained production platform is deployed. */
export interface MaelstromPlatformOutputs {
  /** Verified domain that authorizes the waitlist sender. */
  readonly sendingDomain: string;
  /** Whether Cloudflare reports transactional sending as enabled. */
  readonly sendingEnabled: boolean;
  /** Public site key for the exact managed production widget. */
  readonly turnstileSiteKey: string;
  /** Provider ID of the retained waitlist database. */
  readonly waitlistDatabaseId: string;
  /** Stable name of the retained waitlist database. */
  readonly waitlistDatabaseName: string;
}

/** Production platform stack that cannot run under a preview stage. */
export class MaelstromPlatform extends Alchemy.Stack<
  MaelstromPlatform,
  MaelstromPlatformOutputs
>()('MaelstromPlatform') {}
