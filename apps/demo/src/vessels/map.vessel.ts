import { defineVessel } from '@maelstrom-co/protocol';
import { vessel } from '@maelstrom-co/react';
import { DEMO_LOCATIONS } from '../lib/locations';
import { withActionOptions } from '../lib/vessel-options';
import { MapSkeleton } from './map.skeleton';

const LOCATION_NAMES = DEMO_LOCATIONS.map((location) => location.name);

const baseMapVessel = defineVessel({
  id: 'map',
  name: 'Map',
  description:
    'City map showing saved places and routes. Use this whenever the user asks about getting somewhere, travel time, or directions — including "I need to be at X by Y", "how do I get to X", "when should I leave", or any time an appointment\'s location matters for planning the trip there. Overview shows all locations; route shows directions and travel time to a destination; compact shows a single place card.',
  defaultVariant: 'overview',
  variants: {
    overview: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'showRoute',
          description:
            'Show driving directions and travel time to a destination',
          parameters: [
            {
              name: 'destination',
              type: 'string',
              description: 'Name of the destination location',
            },
          ],
          transitionsTo: 'route',
        },
        {
          name: 'focusLocation',
          description: 'Show a single saved place as a compact card',
          parameters: [
            {
              name: 'name',
              type: 'string',
              description: 'Name of the location to focus on',
            },
          ],
          transitionsTo: 'compact',
        },
      ],
    },
    route: {
      props: {},
      minSize: { width: 6, height: 4 },
      actions: [
        {
          name: 'showOverview',
          description: 'Show all saved locations',
          transitionsTo: 'overview',
        },
        {
          name: 'showRoute',
          description:
            'Show driving directions and travel time to a destination',
          parameters: [
            {
              name: 'destination',
              type: 'string',
              description: 'Name of the destination location',
            },
          ],
        },
        {
          name: 'focusLocation',
          description: 'Show a single saved place as a compact card',
          parameters: [
            {
              name: 'name',
              type: 'string',
              description: 'Name of the location to focus on',
            },
          ],
          transitionsTo: 'compact',
        },
      ],
    },
    compact: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [
        {
          name: 'showOverview',
          description: 'Show all saved locations',
          transitionsTo: 'overview',
        },
        {
          name: 'showRoute',
          description:
            'Show driving directions and travel time to a destination',
          parameters: [
            {
              name: 'destination',
              type: 'string',
              description: 'Name of the destination location',
            },
          ],
          transitionsTo: 'route',
        },
      ],
    },
  },
});

export const mapVessel = withActionOptions(baseMapVessel, {
  showRoute: { destination: LOCATION_NAMES },
  focusLocation: { name: LOCATION_NAMES },
});

export const mapEntry = vessel(
  mapVessel,
  () => import('./map.component'),
  MapSkeleton,
);
