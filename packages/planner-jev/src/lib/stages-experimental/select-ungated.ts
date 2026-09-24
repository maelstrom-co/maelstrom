import { jevSelect } from '../stages/jev-select.js';
import type { SelectStage } from '../stages/stage-types.js';
import type { Ask } from '../typesafe-client.js';

/** The POC's selection, unchanged and without gates. */
export function selectUngated(ask: Ask): SelectStage {
  return jevSelect(ask);
}
