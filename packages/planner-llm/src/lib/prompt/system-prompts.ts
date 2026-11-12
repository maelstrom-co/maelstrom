import type { LayoutMode } from '@maelstrom-co/protocol';

import type { SystemSectionKey } from './sections.js';
import {
  gridReplylessSystemSections,
  gridSystemSections,
} from './system-prompt-grid.js';
import {
  tilingReplylessSystemSections,
  tilingSystemSections,
} from './system-prompt-tiling.js';

/** Whether the system prompt asks the model for a user-facing reply. */
export type SystemSectionReplyVariant = 'with-reply' | 'without-reply';

/** Default system sections for a layout mode, with or without the reply instructions. */
export function getDefaultSystemSections(
  mode: LayoutMode,
  reply: SystemSectionReplyVariant = 'with-reply',
): Record<SystemSectionKey, string> {
  if (reply === 'without-reply') {
    return mode === 'grid'
      ? gridReplylessSystemSections
      : tilingReplylessSystemSections;
  }
  return mode === 'grid' ? gridSystemSections : tilingSystemSections;
}
