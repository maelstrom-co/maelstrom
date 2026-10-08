import {
  createDecisionsClient,
  DECISIONS_MODEL,
} from '@maelstrom-co/planner-jev/_internal';
import type { ClientBuilder } from '../jev/client-builder.js';
import { DECISIONS_ENV, type DecisionsSettings } from './decisions-settings.js';

/** The OpenAI Decisions client on `settings`, labelled `Decisions`. */
export function decisionsClientBuilder(
  settings: DecisionsSettings,
): ClientBuilder {
  return {
    provider: 'Decisions',
    requiredEnv: DECISIONS_ENV,
    meta: () => ({ decisionsModel: settings().model ?? DECISIONS_MODEL }),
    ask: (onCall) => createDecisionsClient({ ...settings(), onCall }),
  };
}
