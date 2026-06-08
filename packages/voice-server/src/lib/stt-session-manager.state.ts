import type { SttCircuitStatus } from './types.js';

export type STTSessionManagerFirstTokenAttemptState = {
  operation: 'start_listening' | null;
  startedAt: number | null;
  recorded: boolean;
};

export type STTSessionManagerForegroundState =
  | {
      kind: 'idle';
    }
  | {
      kind: 'starting';
      promise: Promise<void>;
    };

type STTSessionManagerReconnectBaseState = {
  attempts: number;
  resetTimeout: ReturnType<typeof setTimeout> | null;
};

export type STTSessionManagerReconnectState =
  | (STTSessionManagerReconnectBaseState & {
      kind: 'idle';
    })
  | (STTSessionManagerReconnectBaseState & {
      kind: 'waiting';
      promise: Promise<void>;
      delayResolve: (() => void) | null;
      delayTimeout: ReturnType<typeof setTimeout> | null;
    });

export type STTSessionManagerCircuitState =
  | {
      kind: Extract<SttCircuitStatus, 'closed'>;
    }
  | {
      kind: Extract<SttCircuitStatus, 'half_open'>;
    }
  | {
      kind: Extract<SttCircuitStatus, 'open'>;
      cooldownTimeout: ReturnType<typeof setTimeout> | null;
    };

type STTSessionManagerBaseState = {
  sttUnsubscribe: (() => void) | null;
  firstTokenAttempt: STTSessionManagerFirstTokenAttemptState;
};

type STTSessionManagerIdleLifecycleState = STTSessionManagerBaseState & {
  phase: 'idle';
  foreground: Extract<STTSessionManagerForegroundState, { kind: 'idle' }>;
  reconnect: Extract<STTSessionManagerReconnectState, { kind: 'idle' }>;
  circuit: Extract<
    STTSessionManagerCircuitState,
    { kind: 'closed' | 'half_open' }
  >;
};

type STTSessionManagerStartingLifecycleState = STTSessionManagerBaseState & {
  phase: 'starting';
  foreground: Extract<STTSessionManagerForegroundState, { kind: 'starting' }>;
  reconnect: Extract<STTSessionManagerReconnectState, { kind: 'idle' }>;
  circuit: Extract<
    STTSessionManagerCircuitState,
    { kind: 'closed' | 'half_open' }
  >;
};

type STTSessionManagerReconnectingLifecycleState =
  STTSessionManagerBaseState & {
    phase: 'reconnecting';
    foreground: Extract<STTSessionManagerForegroundState, { kind: 'idle' }>;
    reconnect: Extract<STTSessionManagerReconnectState, { kind: 'waiting' }>;
    circuit: Extract<
      STTSessionManagerCircuitState,
      { kind: 'closed' | 'half_open' }
    >;
  };

type STTSessionManagerCircuitOpenLifecycleState = STTSessionManagerBaseState & {
  phase: 'circuit_open';
  foreground: Extract<STTSessionManagerForegroundState, { kind: 'idle' }>;
  reconnect: Extract<STTSessionManagerReconnectState, { kind: 'idle' }>;
  circuit: Extract<STTSessionManagerCircuitState, { kind: 'open' }>;
};

export type STTSessionManagerPhase =
  | STTSessionManagerIdleLifecycleState['phase']
  | STTSessionManagerStartingLifecycleState['phase']
  | STTSessionManagerReconnectingLifecycleState['phase']
  | STTSessionManagerCircuitOpenLifecycleState['phase'];

export type STTSessionManagerState =
  | STTSessionManagerIdleLifecycleState
  | STTSessionManagerStartingLifecycleState
  | STTSessionManagerReconnectingLifecycleState
  | STTSessionManagerCircuitOpenLifecycleState;

export function deriveSTTSessionManagerPhase(next: {
  foreground: STTSessionManagerForegroundState;
  reconnect: STTSessionManagerReconnectState;
  circuit: STTSessionManagerCircuitState;
}): STTSessionManagerPhase {
  if (next.circuit.kind === 'open') {
    return 'circuit_open';
  }

  if (next.reconnect.kind === 'waiting') {
    return 'reconnecting';
  }

  if (next.foreground.kind === 'starting') {
    return 'starting';
  }

  return 'idle';
}

export function createInitialSTTSessionManagerState(): STTSessionManagerState {
  return {
    phase: 'idle',
    sttUnsubscribe: null,
    firstTokenAttempt: {
      operation: null,
      startedAt: null,
      recorded: false,
    },
    foreground: {
      kind: 'idle',
    },
    reconnect: {
      kind: 'idle',
      attempts: 0,
      resetTimeout: null,
    },
    circuit: {
      kind: 'closed',
    },
  };
}
