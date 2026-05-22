import type {
  Vessel,
  VesselDefinition,
  VesselId,
  VesselValidationResult,
} from '@maelstrom-co/protocol';
import { validateVessel } from '@maelstrom-co/protocol';
import { Store } from '@tanstack/store';

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
  vessel_unregistered: { vesselId: VesselId; vessel: Vessel; timestamp: number };
};

const DEFAULT_OPTIONS = {
  debug: false,
} as const;

/**
 * Manages vessel registration, lookup, and lifecycle events.
 *
 * Creates and owns its own store. Every vessel passes through
 * `validateVessel` so all stored entries carry post-transform brands
 * for IDs, variant names, and action names. Invalid input is rejected:
 * `registerVessel` returns `{ valid: false, issues }` and does not
 * mutate state or emit `vessel_registered`.
 *
 * @example
 * ```ts
 * const manager = new VesselManager({ debug: true });
 *
 * manager.events.on('vessel_registered', (e) => {
 *   console.log(`Registered: ${e.vessel.id}`);
 * });
 *
 * const result = manager.registerVessel(myVessel);
 * if (!result.valid) {
 *   console.error(result.issues);
 * }
 * ```
 */
export class VesselManager {
  readonly store: Store<VesselManagerState>;
  readonly #emitter = new TypedEmitter<VesselManagerEvents>();
  readonly events: EventSubscriber<VesselManagerEvents> = this.#emitter;
  readonly #logger: Logger;

  constructor(options: VesselManagerOptions = {}) {
    const initialState =
      options.initialState ?? createInitialVesselManagerState();
    this.store = new Store<VesselManagerState>(initialState);
    this.#logger = new Logger(
      options.debug ?? DEFAULT_OPTIONS.debug,
      'VesselManager',
    );
  }

  /**
   * Registers a vessel. Always validates through the schema; on failure,
   * returns the validation result without mutating state. Overwrites
   * any existing vessel with the same ID.
   */
  registerVessel(vessel: VesselDefinition): VesselValidationResult {
    if (this.#emitter.disposed) {
      throw new Error('VesselManager is disposed');
    }

    const validation = validateVessel(vessel);

    if (!validation.valid) {
      this.#logger.error(
        `Validation failed for vessel "${vessel.id}":`,
        validation.issues,
      );
      return validation;
    }

    const parsed = validation.vessel;
    this.store.setState((state) => {
      const newVessels = new Map(state.vessels);
      newVessels.set(parsed.id, parsed);
      return { ...state, vessels: newVessels };
    });

    this.#emitter.emit('vessel_registered', {
      vessel: parsed,
      timestamp: Date.now(),
    });

    this.#logger.info(`Registered vessel "${parsed.id}"`);

    return validation;
  }

  /**
   * Unregisters a vessel by ID. Returns the removed vessel, or undefined.
   */
  unregisterVessel(vesselId: string): Vessel | undefined {
    if (this.#emitter.disposed) {
      throw new Error('VesselManager is disposed');
    }

    const vessel = this.store.state.vessels.get(vesselId as VesselId);
    if (!vessel) return undefined;

    this.store.setState((state) => {
      const newVessels = new Map(state.vessels);
      newVessels.delete(vesselId as VesselId);
      return { ...state, vessels: newVessels };
    });

    this.#emitter.emit('vessel_unregistered', {
      vesselId: vessel.id,
      vessel,
      timestamp: Date.now(),
    });

    this.#logger.info(`Unregistered vessel "${vesselId}"`);

    return vessel;
  }

  get(vesselId: string): Vessel | undefined {
    return this.store.state.vessels.get(vesselId as VesselId);
  }

  getAll(): Vessel[] {
    return Array.from(this.store.state.vessels.values());
  }

  has(vesselId: string): boolean {
    return this.store.state.vessels.has(vesselId as VesselId);
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
