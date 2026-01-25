import type { Vessel } from '@maelstrom/protocol';
import type React from 'react';
import type {
  LazyVesselComponentLoader,
  VesselComponentProps,
  VesselLoadingSkeletonProps,
  VesselRegistration,
} from './types';

/**
 * Create a vessel registration with an eager (bundled) component.
 * No loading component needed since the component is immediately available.
 *
 * @param vessel - The vessel definition (metadata for LLM decisions)
 * @param component - The React component to render this vessel
 * @returns A VesselRegistration object
 *
 * @example
 * ```tsx
 * import CalendarComponent from './calendar.component';
 *
 * export const calendarRegistration = vesselRegistration(
 *   calendarVessel,
 *   CalendarComponent,
 * );
 * ```
 */
export function vesselRegistration(
  vessel: Vessel,
  component: React.ComponentType<VesselComponentProps>,
): VesselRegistration;

/**
 * Create a vessel registration with a lazy-loaded component.
 * A loading component is required to show while the component loads.
 *
 * @param vessel - The vessel definition (metadata for LLM decisions)
 * @param component - A function that dynamically imports the component
 * @param loadingComponent - Component to display while loading
 * @returns A VesselRegistration object
 *
 * @example
 * ```tsx
 * import { CalendarSkeleton } from './calendar.skeleton';
 *
 * export const calendarRegistration = vesselRegistration(
 *   calendarVessel,
 *   () => import('./calendar.component'),
 *   CalendarSkeleton,
 * );
 * ```
 */
export function vesselRegistration(
  vessel: Vessel,
  component: LazyVesselComponentLoader,
  loadingComponent: React.ComponentType<VesselLoadingSkeletonProps>,
): VesselRegistration;

/**
 * Create a vessel registration.
 *
 * For eager components (bundled with the app), only the vessel and component are needed.
 * For lazy-loaded components, a loading component is required to show during loading.
 */
export function vesselRegistration(
  vessel: Vessel,
  component:
    | React.ComponentType<VesselComponentProps>
    | LazyVesselComponentLoader,
  loadingComponent?: React.ComponentType<VesselLoadingSkeletonProps>,
): VesselRegistration {
  return { vessel, component, loadingComponent };
}
