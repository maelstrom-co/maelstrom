import type { Store } from '@tanstack/store';
import {
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';

import {
  type ConnectionManagerState,
  type EngineConnector,
  type MessageProcessingState,
  Orchestrator,
  type RequestCoordinatorState,
} from '@maelstrom/client';
import type { LayoutMode } from '@maelstrom/protocol';

import type {
  MaelstromProviderProps,
  VesselComponentProps,
  VesselLoadingSkeletonProps,
  VesselRegistration,
} from './types.js';
import { isLazyLoader } from './types.js';

interface MaelstromContextValue {
  orchestrator: Orchestrator;
  connector: EngineConnector;
  messageProcessorStore: Store<MessageProcessingState>;
  connectionManagerStore: Store<ConnectionManagerState>;
  requestCoordinatorStore: Store<RequestCoordinatorState>;
  componentRegistry: Map<string, React.ComponentType<VesselComponentProps>>;
  loadingRegistry: Map<string, React.ComponentType<VesselLoadingSkeletonProps>>;
