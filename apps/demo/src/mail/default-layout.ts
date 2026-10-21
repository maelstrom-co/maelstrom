import type { TilingLayout } from '@maelstrom-co/protocol';
import {
  InstanceId,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

/** The reader the default layout opens with, showing the newest email. */
export const MAIL_DEFAULT_READER_ID = 'message-main';

const INBOX = InstanceId('inbox-main');
const MESSAGE = InstanceId(MAIL_DEFAULT_READER_ID);
const INBOX_LEAF = tilingLeafToken(INBOX);
const MESSAGE_LEAF = tilingLeafToken(MESSAGE);

/** The mail screen every visitor lands on: the inbox beside the open email. */
export const MAIL_DEFAULT_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: ['V:2,3', INBOX_LEAF, MESSAGE_LEAF],
  instances: [
    {
      instanceId: INBOX,
      vesselId: VesselId('inbox'),
      variant: VariantName('list'),
    },
    {
      instanceId: MESSAGE,
      vesselId: VesselId('message'),
      variant: VariantName('read'),
    },
  ],
};

/** The inbox stacked above the open email, for narrow screens. */
export const MAIL_NARROW_LAYOUT: TilingLayout = {
  ...MAIL_DEFAULT_LAYOUT,
  tree: ['H', INBOX_LEAF, MESSAGE_LEAF],
};
