import type { Vessel } from '@maelstrom-co/protocol-old';
import type React from 'react';

import type {
  LazyVesselComponentLoader,
  VesselComponentProps,
  VesselLoadingSkeletonProps,
  VesselRegistration,
} from './types.js';

export function vesselRegistration(
  vessel: Vessel,
  component: React.ComponentType<VesselComponentProps>,
): VesselRegistration;

export function vesselRegistration(
  vessel: Vessel,
  component: LazyVesselComponentLoader,
  loadingComponent: React.ComponentType<VesselLoadingSkeletonProps>,
): VesselRegistration;

export function vesselRegistration(
  vessel: Vessel,
  component:
    | React.ComponentType<VesselComponentProps>
    | LazyVesselComponentLoader,
  loadingComponent?: React.ComponentType<VesselLoadingSkeletonProps>,
): VesselRegistration {
  const result: VesselRegistration = { vessel, component };
  if (loadingComponent !== undefined) {
    result.loadingComponent = loadingComponent;
  }
  return result;
}
