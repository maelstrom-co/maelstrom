import { useStore } from '@tanstack/react-store';
import { useCallback, useEffect, useRef } from 'react';

import type {
  ActionRunner,
  ConnectionStatus,
  VesselInstance,
} from '@maelstrom/client';
%%%%%%% diff from: nqvxrurm 2789a6b4 "chore: remove completed migration plan files" (parents of rebased revision)
\\\\\\\        to: rqoqwskx b424e402 "chore: rename package scope from @maelstrom to @maelstrom-co" (rebased revision)
-} from '@maelstrom/client';
+} from '@maelstrom-co/client';
 import type {
   ChartDimensions,
   MaelstromResponse,
   Vessel,
   VesselAction,
   VesselVariant,
-} from '@maelstrom/protocol';
+} from '@maelstrom-co/protocol';
 
 import { useMaelstromContext } from './context.js';
 import type { VesselComponentProps, VesselRegistration } from './types.js';
 
 export function useMaelstrom(): {
   processIntent: (intent: string) => Promise<void>;
   addAssistantMessage: ((message: string) => Promise<void>) | undefined;
   chartDimensions: ChartDimensions;
   connectionStatus: ConnectionStatus;
   isProcessing: boolean;
   lastResponse: MaelstromResponse | null;
   lastError: Error | null;
   instances: Array<{
     instanceId: string;
     vesselId: string;
     variant: string;
     position: { row: number; column: number };
     size: { width: number; height: number };
   }>;
   cellSizePx: number;
   debug: boolean;
   sessionId: string;
 } {
   const {
     messageProcessorStore,
     connectionManagerStore,
     requestCoordinatorStore,
     processIntent,
     cellSizePx,
     debug,
     orchestrator,
     connector,
   } = useMaelstromContext();
 
   const chartDimensions = useStore(
     orchestrator.chartManager.store,
     (state) => state.chartDimensions,
   );
   const connectionStatus = useStore(
     connectionManagerStore,
     (state) => state.connectionStatus,
   );
   const isProcessing = useStore(
     requestCoordinatorStore,
     (state) => state.isProcessing,
   );
   const lastResponse = useStore(
     requestCoordinatorStore,
     (state) => state.lastResponse,
   );
   const lastError = useStore(messageProcessorStore, (state) => state.lastError);
   const instances = useStore(messageProcessorStore, (state) =>
     Array.from(state.instances.values()),
   );
 
   const addAssistantMessage = useCallback(
     async (message: string): Promise<void> => {
       await orchestrator.addAssistantMessage(message);
     },
     [orchestrator],
   );
 
   const canAddAssistantMessage = 'addAssistantMessage' in connector;
 
   return {
     processIntent,
     addAssistantMessage: canAddAssistantMessage
       ? addAssistantMessage
       : undefined,
     chartDimensions,
     connectionStatus,
     isProcessing,
     lastResponse,
     lastError,
     instances,
     cellSizePx,
     debug,
     sessionId: orchestrator.getConfig().sessionId,
   };
 }
 
 export function useVesselRegistration(registration: VesselRegistration): void {
   const { registerVessel, unregisterVessel } = useMaelstromContext();
 
   useEffect(() => {
     registerVessel(registration);
     return () => {
       unregisterVessel(registration.vessel.id);
     };
   }, [registerVessel, unregisterVessel, registration]);
 }
 
 export function useVessel(vesselId: string): Vessel | undefined {
   const { orchestrator } = useMaelstromContext();
   return useStore(orchestrator.vesselManager.store, (state) =>
     state.vessels.get(vesselId),
   );
 }
 
 export function useInstance(instanceId: string): VesselInstance | undefined {
   const { messageProcessorStore } = useMaelstromContext();
   return useStore(messageProcessorStore, (state) =>
     state.instances.get(instanceId),
   );
 }
 
 export function useInstancesByVessel(vesselId: string): VesselInstance[] {
   const { messageProcessorStore } = useMaelstromContext();
   return useStore(messageProcessorStore, (state) =>
     Array.from(state.instances.values()).filter((i) => i.vesselId === vesselId),
   );
 }
 
 export function useInstanceVariant(
   instanceId: string,
 ): VesselVariant | undefined {
   const instance = useInstance(instanceId);
   const vessel = useVessel(instance?.vesselId ?? '');
   if (!instance || !vessel) return undefined;
 
   return vessel.variants[instance.variant];
 }
 
 export function useInstanceActions(instanceId: string): VesselAction[] {
   const variant = useInstanceVariant(instanceId);
   return variant?.actions || [];
 }
 
 export function useChartDimensions(): ChartDimensions {
   const { orchestrator } = useMaelstromContext();
   return useStore(
     orchestrator.chartManager.store,
     (state) => state.chartDimensions,
   );
 }
 
 export function useSetChartDimensions() {
   const { orchestrator } = useMaelstromContext();
 
   return useCallback(
     (dimensions: ChartDimensions) => {
       orchestrator.chartManager.setDimensions({ ...dimensions });
     },
     [orchestrator],
   );
 }
 
 export function useChartDimensionsFromViewport() {
   const { cellSizePx } = useMaelstromContext();
   const setDimensions = useSetChartDimensions();
 
   return useCallback(
     (viewportWidth: number, viewportHeight: number) => {
       const columns = Math.floor(viewportWidth / cellSizePx);
       const rows = Math.floor(viewportHeight / cellSizePx);
       setDimensions({ columns, rows });
     },
     [cellSizePx, setDimensions],
   );
 }
 
 export function useConnectionStatus(): ConnectionStatus {
   const { connectionManagerStore } = useMaelstromContext();
   return useStore(connectionManagerStore, (state) => state.connectionStatus);
 }
 
 export function useVesselComponentProps(
   instanceId: string,
 ): VesselComponentProps | null {
   const { debug } = useMaelstromContext();
 
   const instance = useInstance(instanceId);
   const vessel = useVessel(instance?.vesselId ?? '');
 
   const executeAction = useCallback(
     (actionName: string, params?: Record<string, unknown>) => {
       if (debug) {
         console.log(
           `[Maelstrom] executeAction stub called: ${actionName}`,
           params,
         );
       }
       console.warn(
         `[Maelstrom] executeAction is not yet implemented. Action '${actionName}' was not executed.`,
       );
     },
     [debug],
   );
 
   if (!instance || !vessel) return null;
 
   const variant = vessel.variants[instance.variant];
   if (!variant) return null;
 
   return {
     instance,
     variantProps: variant.props,
     executeAction,
   };
 }
 
 /**
  * Register action handlers for a vessel instance.
  *
  * @param instanceId - Vessel instance ID
  * @param runner - Action handlers keyed by action name
  */
 export function useVesselActions<V extends Vessel = Vessel>(
   instanceId: string,
   runner: ActionRunner<V>,
 ): void {
   const { orchestrator, debug } = useMaelstromContext();
 
   const runnerRef = useRef(runner);
   runnerRef.current = runner;
 
   useEffect(() => {
     if (debug) {
       console.log(
         `[Maelstrom] Registering action runner for instance "${instanceId}"`,
       );
     }
 
     // Proxy delegates every call to the latest ref, keeping the ActionRunner<V> type
     const stableRunner = new Proxy(runnerRef.current, {
       get(_, prop: string) {
         return (runnerRef.current as Record<string, unknown>)[prop];
       },
     });
 
     orchestrator.messageProcessor
       .getActionManager()
       .registerRunner(instanceId, stableRunner);
 
     return () => {
       if (debug) {
         console.log(
           `[Maelstrom] Unregistering action runner for instance "${instanceId}"`,
         );
       }
       orchestrator.messageProcessor
         .getActionManager()
         .unregisterRunner(instanceId);
     };
   }, [instanceId, orchestrator, debug]);
 }
