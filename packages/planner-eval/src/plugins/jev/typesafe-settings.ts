import type { TypeSafeClientOptions } from '@maelstrom-co/planner-jev/_internal';

/** Connection settings for one TypeSafe client, read when a turn starts so a missing key fails the run, not the import. */
export type TypeSafeSettings = () => Omit<TypeSafeClientOptions, 'onCall'>;

/** The environment variables the settings read when `overrides` leave a value out. */
export const TYPESAFE_ENV = ['TYPESAFE_API_KEY', 'JEV_MODEL'] as const;

/** Settings from `overrides`, falling back to `TYPESAFE_API_KEY` and `JEV_MODEL`. */
export function typesafeSettings(
  overrides: Partial<Omit<TypeSafeClientOptions, 'onCall'>> = {},
): TypeSafeSettings {
  return () => ({
    ...overrides,
    apiKey: overrides.apiKey ?? process.env.TYPESAFE_API_KEY?.trim() ?? '',
    model: overrides.model ?? process.env.JEV_MODEL?.trim() ?? '',
  });
}
