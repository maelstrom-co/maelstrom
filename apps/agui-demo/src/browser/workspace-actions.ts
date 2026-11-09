import type { CommandProcessor } from '@maelstrom-co/client';
import { LAB_MARKER_SLUGS } from '@maelstrom-co/demo-vessels/vessels/labs.vessel.def';
import type { InstanceId } from '@maelstrom-co/protocol';
import { z } from 'zod';

import type {
  calendarVessel,
  journalVessel,
  labsVessel,
  mapVessel,
  tasksVessel,
  weatherVessel,
} from '../vessels/definitions';
import type { WorkspaceState } from './workspace-state';

function register(
  processor: CommandProcessor,
  store: WorkspaceState,
  instanceId: InstanceId,
  vesselId: string,
) {
  switch (vesselId) {
    case 'journal':
      return processor.registerRunner<typeof journalVessel>(instanceId, {
        createEntry: () => store.action(instanceId, 'createEntry'),
        writeContent: () => store.action(instanceId, 'writeContent'),
        openEntry: (params) =>
          store.action(instanceId, 'openEntry', () =>
            store.selectEntry(params),
          ),
        backToList: () =>
          store.action(instanceId, 'backToList', () =>
            store.update({ entryId: null }),
          ),
      });
    case 'tasks':
      return processor.registerRunner<typeof tasksVessel>(instanceId, {
        addTask: () => store.action(instanceId, 'addTask'),
        removeTask: () => store.action(instanceId, 'removeTask'),
        checkTask: () => store.action(instanceId, 'checkTask'),
        uncheckTask: () => store.action(instanceId, 'uncheckTask'),
        addSubtask: () => store.action(instanceId, 'addSubtask'),
      });
    case 'calendar':
      return processor.registerRunner<typeof calendarVessel>(instanceId, {
        addEvent: () => store.action(instanceId, 'addEvent'),
        removeEvent: () => store.action(instanceId, 'removeEvent'),
        moveEvent: () => store.action(instanceId, 'moveEvent'),
        showDay: () => store.action(instanceId, 'showDay', () => {}),
        showWeek: () => store.action(instanceId, 'showWeek', () => {}),
        showMonth: () => store.action(instanceId, 'showMonth', () => {}),
      });
    case 'weather':
      return processor.registerRunner<typeof weatherVessel>(instanceId, {
        showCurrent: () => store.action(instanceId, 'showCurrent', () => {}),
        showHourly: () => store.action(instanceId, 'showHourly', () => {}),
        showWeekly: () => store.action(instanceId, 'showWeekly', () => {}),
        setLocation: ({ location }) =>
          store.action(instanceId, 'setLocation', () =>
            store.setLocation(location),
          ),
      });
    case 'labs':
      return processor.registerRunner<typeof labsVessel>(instanceId, {
        showList: () => store.action(instanceId, 'showList', () => {}),
        showTrends: () => store.action(instanceId, 'showTrends', () => {}),
        selectMarker: ({ markerSlug }) =>
          store.action(instanceId, 'selectMarker', () =>
            store.update({
              marker: z.enum(LAB_MARKER_SLUGS).parse(markerSlug),
            }),
          ),
      });
    case 'map':
      return processor.registerRunner<typeof mapVessel>(instanceId, {
        showOverview: () =>
          store.action(instanceId, 'showOverview', () =>
            store.update({ map: {} }),
          ),
        showRoute: ({ destination }) =>
          store.action(instanceId, 'showRoute', () =>
            store.routeTo(destination),
          ),
        focusLocation: ({ name }) =>
          store.action(instanceId, 'focusLocation', () =>
            store.focusLocation(name),
          ),
      });
  }
  return undefined;
}

export function bindWorkspaceActions(
  processor: CommandProcessor,
  store: WorkspaceState,
) {
  const registrations = new Map<
    InstanceId,
    { vesselId: string; dispose: () => void }
  >();
  const sync = () => {
    const instances = processor.store.state.instances;
    for (const [id, registration] of registrations) {
      if (instances.get(id)?.vesselId === registration.vesselId) continue;
      registration.dispose();
      registrations.delete(id);
    }
    for (const [id, instance] of instances) {
      if (registrations.has(id)) continue;
      const dispose = register(processor, store, id, instance.vesselId);
      if (dispose)
        registrations.set(id, { vesselId: instance.vesselId, dispose });
    }
  };
  const subscription = processor.store.subscribe(sync);
  sync();
  return () => {
    subscription.unsubscribe();
    for (const registration of registrations.values()) registration.dispose();
    registrations.clear();
  };
}
