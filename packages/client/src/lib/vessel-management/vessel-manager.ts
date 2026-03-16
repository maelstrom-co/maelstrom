import { Store } from '@tanstack/store';

import type { Vessel, VesselValidationResult } from '@maelstrom-co/protocol';
import { validateVessel } from '@maelstrom-co/protocol';

import { Logger } from '../utils/logger.js';
import { type EventSubscriber, TypedEmitter } from '../utils/typed-emitter.js';
import {
  createInitialVesselManagerState,
  type VesselManagerState,
} from './vessel-manager.state.js';
import type { VesselManagerOptions } from './vessel-manager.types.js';

/**
 * Event map for VesselManager lifecycle events.
 */
export type VesselManagerEvents = {
  vessel_registered: { vessel: Vessel; timestamp: number };
  vessel_unregistered: { vesselId: string; vessel: Vessel; timestamp: number };
};

const DEFAULT_OPTIONS = {
  validateOnRegister: true,
  debug: false,
} as const;

/**
 * Manages vessel registration, lookup, and lifecycle events.
 *
 * Creates and owns its own store. Provides vessel registration
 * with optional validation, event-driven lifecycle notifications,
 * and disposable cleanup.
 *
 * @example
 * ```ts
 * const manager = new VesselManager({ validateOnRegister: true });
 *
 * manager.events.on('vessel_registered', (e) => {
 *   console.log(`Registered: ${e.vessel.id}`);
 * });
 *
 * const result = manager.registerVessel(myVessel);
 * ```
 */
export class VesselManager {
  readonly store: Store<VesselManagerState>;
  readonly #emitter = new TypedEmitter<VesselManagerEvents>();
  readonly events: EventSubscriber<VesselManagerEvents> = this.#emitter;
  readonly #logger: Logger;
  readonly #validateOnRegister: boolean;

  constructor(options: VesselManagerOptions = {}) {
    const initialState =
      options.initialState ?? createInitialVesselManagerState();
    this.store = new Store<VesselManagerState>(initialState);
    this.#validateOnRegister =
      options.validateOnRegister ?? DEFAULT_OPTIONS.validateOnRegister;
    this.#logger = new Logger(
      options.debug ?? DEFAULT_OPTIONS.debug,
      'VesselManager',
    );
  }

  /**
   * Registers a vessel. Validates first if `validateOnRegister` is enabled.
   * Overwrites existing vessel with the same ID.
   */
  registerVessel(vessel: Vessel): VesselValidationResult {
    if (this.#emitter.disposed) {
      throw new Error('VesselManager is disposed');
    }

    if (this.#validateOnRegister) {
      const validation = validateVessel(vessel);
      if (!validation.valid) {
        this.#logger.error(
          `Validation failed for vessel "${vessel.id}":`,
          validation.issues,
        );
        return validation;
      }
    }

    this.store.setState((state) => {
      const newVessels = new Map(state.vessels);
      newVessels.set(vessel.id, vessel);
      return { ...state, vessels: newVessels };
    });

    this.#emitter.emit('vessel_registered', {
      vessel,
      timestamp: Date.now(),
    });

    this.#logger.info(`Registered vessel "${vessel.id}"`);

    return { valid: true, issues: [] };
  }

  /**
   * Unregisters a vessel by ID. Returns the removed vessel, or undefined.
   */
  unregisterVessel(vesselId: string): Vessel | undefined {
    if (this.#emitter.disposed) {
      throw new Error('VesselManager is disposed');
    }

    const vessel = this.store.state.vessels.get(vesselId);
    if (!vessel) return undefined;

    this.store.setState((state) => {
      const newVessels = new Map(state.vessels);
      newVessels.delete(vesselId);
      return { ...state, vessels: newVessels };
    });

    this.#emitter.emit('vessel_unregistered', {
      vesselId,
      vessel,
      timestamp: Date.now(),
    });

    this.#logger.info(`Unregistered vessel "${vesselId}"`);

    return vessel;
  }

  get(vesselId: string): Vessel | undefined {
    return this.store.state.vessels.get(vesselId);
  }

  getAll(): Vessel[] {
    return Array.from(this.store.state.vessels.values());
  }

  has(vesselId: string): boolean {
    return this.store.state.vessels.has(vesselId);
  }

  get size(): number {
    return this.store.state.vessels.size;
  }

  getRegisteredIds(): string[] {
    return Array.from(this.store.state.vessels.keys());
  }

  dispose(): void {
    if (this.#emitter.disposed) return;

    this.#emitter.dispose();

    this.store.setState((state) => ({
      ...state,
      vessels: new Map(),
    }));

    this.#logger.info('Disposed VesselManager');
  }
}
