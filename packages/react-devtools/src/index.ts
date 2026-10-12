import type { DevtoolsOptions } from '@maelstrom-co/devtools';
import type { MaelstromExtension } from '@maelstrom-co/react';
import {
  devtools as createExtension,
  type DevtoolsExtension,
} from './production.js';

export type { DevtoolsOptions } from '@maelstrom-co/devtools';
export type { DevtoolsExtension } from './production.js';

/** Adds development diagnostics to a Maelstrom instance without requiring voice. */
export function devtools(
  options: DevtoolsOptions = {},
): MaelstromExtension<DevtoolsExtension> {
  return (context) => {
    if (process.env.NODE_ENV !== 'development' || options.enabled === false)
      return { Devtools: () => null };
    return createExtension(options)(context);
  };
}
