import * as Alchemy from 'alchemy';

export interface MaelstromPlatformOutputs {
  readonly sendingDomain: string;
  readonly sendingEnabled: boolean;
  readonly turnstileSitekey: string;
  readonly waitlistDatabaseId: string;
  readonly waitlistDatabaseName: string;
}

export class MaelstromPlatform extends Alchemy.Stack<
  MaelstromPlatform,
  MaelstromPlatformOutputs
>()('MaelstromPlatform') {}
