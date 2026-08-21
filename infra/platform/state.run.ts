import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';

export default Alchemy.Stack(
  'MaelstromStateInspection',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.succeed({}),
);
