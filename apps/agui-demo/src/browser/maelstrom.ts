import { MapSkeleton } from '@maelstrom-co/demo-vessels/vessels/map.skeleton';
import { createMaelstrom, vessel } from '@maelstrom-co/react';

import { Calendar, Journal, Labs, Tasks, Weather } from '../vessels/components';
import {
  calendarVessel,
  journalVessel,
  labsVessel,
  mapVessel,
  tasksVessel,
  weatherVessel,
} from '../vessels/definitions';

export const m = createMaelstrom({
  vessels: [
    vessel(calendarVessel, Calendar),
    vessel(journalVessel, Journal),
    vessel(tasksVessel, Tasks),
    vessel(weatherVessel, Weather),
    vessel(labsVessel, Labs),
    vessel(mapVessel, () => import('../vessels/map'), MapSkeleton),
  ],
}).with((context) => ({
  useWorkspaceOrchestrator: () => context.useMaelstromContext().orchestrator,
}));
