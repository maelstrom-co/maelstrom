import { vessel } from '@maelstrom-co/react';
import { NotificationsSkeleton } from './notifications.skeleton';
import { notificationsVessel } from './notifications.vessel.def';

export { notificationsVessel };

export const notificationsEntry = vessel(
  notificationsVessel,
  () => import('./notifications.component'),
  NotificationsSkeleton,
);
