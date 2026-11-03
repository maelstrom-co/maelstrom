import {
  InstanceId,
  type TilingLayout,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

// The demo calendar shape: view switches are pure transitions, addEvent is a
// handler-only Action.
export const calendarVessel = {
  id: 'calendar',
  name: 'Calendar',
  description: 'Calendar with day, week and month views',
  defaultVariant: 'day',
  variants: {
    day: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        { name: 'addEvent', description: 'Add an event' },
        { name: 'showWeek', description: 'Week view', transitionsTo: 'week' },
        {
          name: 'showMonth',
          description: 'Month view',
          transitionsTo: 'month',
        },
      ],
    },
    week: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        { name: 'addEvent', description: 'Add an event' },
        { name: 'showDay', description: 'Day view', transitionsTo: 'day' },
        {
          name: 'showMonth',
          description: 'Month view',
          transitionsTo: 'month',
        },
      ],
    },
    month: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        { name: 'showDay', description: 'Day view', transitionsTo: 'day' },
        { name: 'showWeek', description: 'Week view', transitionsTo: 'week' },
      ],
    },
  },
} as const;

export const calendarMain = InstanceId('calendar-main');

export function createCalendarLayout(variant: string): TilingLayout {
  return {
    type: 'tiling',
    tree: [],
    instances: [
      {
        instanceId: calendarMain,
        vesselId: VesselId('calendar'),
        variant: VariantName(variant),
      },
    ],
  };
}
