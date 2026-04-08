import { defineVessel } from '@maelstrom-co/protocol-old';
import { vesselRegistration } from '@maelstrom-co/react-old';
import { WeatherSkeleton } from './weather.skeleton';

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
        {
          name: 'showHourly',
          description: 'Show hourly forecast for today',
          transitionsTo: 'hourly',
        },
        {
          name: 'showWeekly',
          description: 'Show weekly forecast',
          transitionsTo: 'weekly',
        },
      ],
    },
    hourly: {
      props: {},
      minSize: { width: 6, height: 4 },
      actions: [
        {
          name: 'showCurrent',
          description: 'Show current conditions',
          transitionsTo: 'current',
        },
        {
          name: 'showWeekly',
          description: 'Show weekly forecast',
          transitionsTo: 'weekly',
        },
      ],
    },
    weekly: {
      props: {},
      minSize: { width: 8, height: 3 },
      actions: [
        {
          name: 'showCurrent',
          description: 'Show current conditions',
          transitionsTo: 'current',
        },
        {
          name: 'showHourly',
          description: 'Show hourly forecast',
          transitionsTo: 'hourly',
        },
      ],
    },
  },
});

export const weatherRegistration = vesselRegistration(
  weatherVessel,
  () => import('./weather.component'),
  WeatherSkeleton,
);
