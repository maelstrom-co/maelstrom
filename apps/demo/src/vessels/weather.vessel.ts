import type { Vessel } from '@maelstrom-co/protocol-old';
import { vesselRegistration } from '@maelstrom-co/react-old';
import { WeatherSkeleton } from './weather.skeleton';

// Weather vessel definition - always eagerly loaded for LLM decisions
export const weatherVessel: Vessel = {
  id: 'weather',
  name: 'Weather',
  description:
    'Weather widget showing current conditions or extended forecast. Can display current weather, hourly forecast, or weekly forecast.',
  defaultVariant: 'current',
  variants: {
    current: {
      props: { mode: 'current' },
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
      props: { mode: 'hourly' },
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
      props: { mode: 'weekly' },
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
};

// Lazy registration - component is loaded on first render
// Uses vesselRegistration helper which requires a loading component for lazy loading
export const weatherRegistration = vesselRegistration(
  weatherVessel,
  () => import('./weather.component'),
  WeatherSkeleton,
);
