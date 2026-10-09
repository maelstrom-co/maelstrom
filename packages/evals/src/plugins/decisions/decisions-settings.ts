import {
  DECISIONS_MODEL,
  type DecisionsClientOptions,
} from '@maelstrom-co/planner-jev/_internal';

/** Connection settings for one Decisions client, read each time a client is built and each time its meta is printed, so a missing key fails the run, not the import. */
export type DecisionsSettings = () => Omit<DecisionsClientOptions, 'onCall'>;

/** The environment variables the settings read when `overrides` leave a value out. */
export const DECISIONS_ENV = ['OPENAI_API_KEY'] as const;

/** Settings from `overrides`, falling back to `OPENAI_API_KEY` and the Decisions model. */
export function decisionsSettings(
  overrides: Partial<Omit<DecisionsClientOptions, 'onCall'>> = {},
): DecisionsSettings {
  return () => ({
    ...overrides,
    apiKey: overrides.apiKey ?? process.env.OPENAI_API_KEY?.trim() ?? '',
    model: overrides.model ?? DECISIONS_MODEL,
  });
}
