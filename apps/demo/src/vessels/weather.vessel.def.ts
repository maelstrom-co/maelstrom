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

const showCompactAction = {
  name: 'showCompact',
  idempotent: true,
  description:
    'Shrink weather to a one-line strip with location, temperature and condition',
  transitionsTo: 'compact',
} as const;

export const weatherVessel = defineVessel({
  id: 'weather',
  name: 'Weather',
  description:
    'Weather widget that loads a default location on its own, so it can be shown without asking for a place. Current shows conditions in detail, hourly shows the next 12 hours, weekly shows 7 days, and compact is a one-line strip with location, temperature and condition for when weather should take very little space.',
  defaultVariant: 'current',
  variants: {
    current: {
      description:
        'Current conditions with a large temperature, icon, high and low, and wind. Needs a medium or large region.',
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
        showCompactAction,
      ],
    },
    hourly: {
      description:
        'Hourly temperature bars for the next 12 hours. Needs a wide medium or large region.',
      props: {},
      // 12 bars need ~29px per text-xs font-mono hour label. At the default
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
        showCompactAction,
      ],
    },
    weekly: {
      description:
        'Seven-day forecast with highs, lows and conditions. Needs a wide medium or large region.',
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
        showCompactAction,
      ],
    },
    compact: {
      description:
        'A one-line strip with location, temperature and condition, made for small or thin regions such as a short row under another Vessel. Use it when the user asks for weather to be small, minimal, compact or tucked away. It is readable at a single row of height, so give it the smallest share: about one eighth of the height next to its neighbour (a weight of 1 against 7 or more), not a quarter.',
      props: {},
      minSize: { width: 3, height: 1 },
      actions: [
        setLocationAction,
        {
          name: 'showCurrent',
          idempotent: true,
          description: 'Show current conditions in detail',
          transitionsTo: 'current',
        },
        {
          name: 'showHourly',
          idempotent: true,
          description: 'Show hourly forecast',
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
  },
});
