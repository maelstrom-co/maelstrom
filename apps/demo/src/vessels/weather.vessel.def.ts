import { defineVessel } from '@maelstrom-co/protocol';

const setLocationAction = {
  name: 'setLocation',
  idempotent: true,
  description:
    'Try to load weather for a city or place without assuming the request succeeds',
  parameters: [
    {
      name: 'location',
      type: 'string',
      description: 'City or place to request weather for',
    },
  ],
} as const;

export const weatherVessel = defineVessel({
  id: 'weather',
  name: 'Weather',
  description:
    'Weather widget showing current conditions or extended forecast. Can display current weather, hourly forecast, or weekly forecast.',
  defaultVariant: 'current',
  variants: {
    current: {
      props: {},
      minSize: { width: 6, height: 4 },
      actions: [
        setLocationAction,
        {
          name: 'showHourly',
          idempotent: true,
          description: 'Show hourly forecast for today',
          transitionsTo: 'hourly',
        },
        {
          name: 'showWeekly',
          idempotent: true,
          description: 'Show weekly forecast',
          transitionsTo: 'weekly',
        },
      ],
    },
    hourly: {
      props: {},
      // 12 bars need ~29px per text-xs font-mono hour label; at the default
      // 80px cell size, 6 cells leaves only ~25px per column after
      // padding/gaps, so labels overflow and collide at that minimum.
      minSize: { width: 9, height: 4 },
      actions: [
        setLocationAction,
        {
          name: 'showCurrent',
          idempotent: true,
          description: 'Show current conditions',
          transitionsTo: 'current',
        },
        {
          name: 'showWeekly',
          idempotent: true,
          description: 'Show weekly forecast',
          transitionsTo: 'weekly',
        },
      ],
    },
    weekly: {
      props: {},
      minSize: { width: 8, height: 3 },
      actions: [
        setLocationAction,
        {
          name: 'showCurrent',
          idempotent: true,
          description: 'Show current conditions',
          transitionsTo: 'current',
        },
        {
          name: 'showHourly',
          idempotent: true,
          description: 'Show hourly forecast',
          transitionsTo: 'hourly',
        },
      ],
    },
  },
});
