import { jevSelect } from '../stages/jev-select.js';
import type { Ask } from '../typesafe-client.js';
import type { SelectStage } from './types.js';

/** The POC's selection, unchanged and without gates. */
export function selectV1(ask: Ask): SelectStage {
  return jevSelect(ask);
}
