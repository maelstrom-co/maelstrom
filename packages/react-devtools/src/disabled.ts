import type { DevtoolsOptions } from '@maelstrom-co/devtools';
import type { MaelstromExtension } from '@maelstrom-co/react';
import type { DevtoolsExtension } from './index.js';

export type { DevtoolsOptions } from '@maelstrom-co/devtools';
export type { DevtoolsExtension } from './index.js';
/** Production entrypoint attaches no observers and renders no UI. */
export function devtools(
  _options: DevtoolsOptions = {},
): MaelstromExtension<DevtoolsExtension> {
  return () => ({ Devtools: () => null });
}
