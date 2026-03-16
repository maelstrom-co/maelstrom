import type React from 'react';

import type { EngineConnector, VesselInstance } from '@maelstrom-co/client';
import type {
  LayoutMode,
  MaelstromResponse,
  Vessel,
} from '@maelstrom-co/protocol';

export type {
  ConnectionStatus,
%%%%%%% diff from: nqvxrurm 2789a6b4 "chore: remove completed migration plan files" (parents of rebased revision)
\\\\\\\        to: rqoqwskx b424e402 "chore: rename package scope from @maelstrom to @maelstrom-co" (rebased revision)
   EngineConnector,
   VesselInstance,
-} from '@maelstrom/client';
+} from '@maelstrom-co/client';
 
 export type LazyVesselComponentLoader = () => Promise<{
   default: React.ComponentType<VesselComponentProps>;
 }>;
 
 export interface VesselRegistration {
   vessel: Vessel;
   component:
     | React.ComponentType<VesselComponentProps>
     | LazyVesselComponentLoader;
   loadingComponent?: React.ComponentType<VesselLoadingSkeletonProps>;
 }
 
 export interface VesselLoadingSkeletonProps {
   vesselId: string;
   vesselName?: string;
 }
 
 export function isLazyLoader(
   component:
     | React.ComponentType<VesselComponentProps>
     | LazyVesselComponentLoader,
 ): component is LazyVesselComponentLoader {
   if (typeof component !== 'function') {
     return false;
   }
 
   if (component.prototype?.isReactComponent) {
     return false;
   }
 
   if ('$$typeof' in component) {
     return false;
   }
 
   return component.length === 0;
 }
 
 export interface VesselComponentProps {
   instance: VesselInstance;
   variantProps: Record<string, unknown>;
   executeAction: (actionName: string, params?: Record<string, unknown>) => void;
 }
 
 export interface MaelstromProviderProps {
   connector: EngineConnector;
   sessionId?: string;
   cellSizePx?: number;
   debug?: boolean;
   layoutMode?: LayoutMode;
   tilingPadding?: number;
   onResponse?: (response: MaelstromResponse) => void;
   onError?: (error: Error) => void;
   children: React.ReactNode;
 }
