import type { LayoutMode } from '@maelstrom-co/protocol';

import type { SystemSectionKey } from './sections.js';
import { gridSystemSections } from './system-prompt-grid.js';
import { tilingSystemSections } from './system-prompt-tiling.js';

export function getDefaultSystemSections(
  mode: LayoutMode,
): Record<SystemSectionKey, string> {
  return mode === 'grid' ? gridSystemSections : tilingSystemSections;
}
