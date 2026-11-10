import {
  InstanceId,
  type TilingLayout,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

// `showDetails` and `showList` only switch the view. `selectItem` transitions
// too, but only its handler can select the item, so it declares no effect.
export const listDetailVessel = {
  id: 'inbox',
  name: 'Inbox',
  description: 'Items with a list and a detail view',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        {
          name: 'showDetails',
          description: 'Detail view',
          transitionsTo: 'detail',
          effect: 'none',
        },
        {
          name: 'selectItem',
          description: 'Open one item in the detail view',
          transitionsTo: 'detail',
          parameters: [
            {
              name: 'id',
              type: 'string',
              description: 'Item id',
              required: true,
            },
          ],
        },
      ],
    },
    detail: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        {
          name: 'selectItem',
          description: 'Open another item',
          parameters: [
            {
              name: 'id',
              type: 'string',
              description: 'Item id',
              required: true,
            },
          ],
        },
        {
          name: 'showList',
          description: 'List view',
          transitionsTo: 'list',
          effect: 'none',
        },
      ],
    },
  },
} as const;

export const inboxMain = InstanceId('inbox-main');

export function createInboxLayout(variant: string): TilingLayout {
  return {
    type: 'tiling',
    tree: [],
    instances: [
      {
        instanceId: inboxMain,
        vesselId: VesselId('inbox'),
        variant: VariantName(variant),
      },
    ],
  };
}
