import { beforeEach, describe, expect, it } from 'bun:test';

import type { Vessel } from '@maelstrom/protocol';

import type { VesselManagerEvents } from './vessel-manager.js';
import { VesselManager } from './vessel-manager.js';

type VesselRegisteredEvent = VesselManagerEvents['vessel_registered'];
type VesselUnregisteredEvent = VesselManagerEvents['vessel_unregistered'];

function createValidVessel(overrides?: Partial<Vessel>): Vessel {
  return {
    id: 'test-vessel',
    name: 'Test Vessel',
    description: 'A test vessel for validation',
    defaultVariant: 'default',
    variants: {
      default: {
        description: 'Default variant',
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [
          {
            name: 'testAction',
            description: 'Test action',
            parameters: [
              {
                name: 'param1',
                type: 'string',
                description: 'A string parameter',
                required: true,
              },
            ],
          },
        ],
      },
    },
    ...overrides,
  };
}

describe('VesselManager', () => {
  let manager: VesselManager;

  beforeEach(() => {
    manager = new VesselManager();
  });

  describe('initialization', () => {
    it('should initialize with empty vessels map', () => {
      expect(manager.store.state.vessels.size).toBe(0);
    });

    it('should accept custom initial state', () => {
      const vessel = createValidVessel();
      const custom = new VesselManager({
        initialState: { vessels: new Map([['test-vessel', vessel]]) },
      });
      expect(custom.size).toBe(1);
      expect(custom.get('test-vessel')).toBe(vessel);
    });
  });

  describe('registerVessel', () => {
    it('should register a valid vessel', () => {
      const vessel = createValidVessel();
      const result = manager.registerVessel(vessel);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(manager.has(vessel.id)).toBe(true);
    });

    it('should emit vessel_registered event on registration', () => {
      const vessel = createValidVessel();
      const events: VesselRegisteredEvent[] = [];
      manager.events.on('vessel_registered', (e) => {
        events.push(e);
      });

      manager.registerVessel(vessel);

      expect(events).toHaveLength(1);
      expect(events[0].vessel).toBe(vessel);
      expect(events[0].timestamp).toBeGreaterThan(0);
    });

    it('should emit vessel_registered event when re-registering same vessel', () => {
      const vessel1 = createValidVessel({ name: 'Vessel 1' });
      const vessel2 = createValidVessel({ name: 'Vessel 2' });
      const events: VesselRegisteredEvent[] = [];
      manager.events.on('vessel_registered', (e) => {
        events.push(e);
      });

      manager.registerVessel(vessel1);
      manager.registerVessel(vessel2);

      expect(events).toHaveLength(2);
      expect(events[1].vessel).toBe(vessel2);
    });

    it('should overwrite existing vessel with same id', () => {
      const vessel1 = createValidVessel({ name: 'Vessel 1' });
      const vessel2 = createValidVessel({ name: 'Vessel 2' });

      manager.registerVessel(vessel1);
      manager.registerVessel(vessel2);

      const retrieved = manager.get(vessel1.id);
      expect(retrieved?.name).toBe('Vessel 2');
    });

    it('should fail validation for vessel without id', () => {
      const vessel = createValidVessel({ id: '' });
      const result = manager.registerVessel(vessel);

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].message).toContain('id');
    });

    it('should fail validation for vessel without name', () => {
      const vessel = createValidVessel({ name: '' });
      const result = manager.registerVessel(vessel);

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should fail validation for vessel without description', () => {
      const vessel = createValidVessel({ description: '' });
      const result = manager.registerVessel(vessel);

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should fail validation for vessel with empty variants', () => {
      const vessel = createValidVessel({ variants: {} });
      const result = manager.registerVessel(vessel);

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should fail validation when defaultVariant does not exist', () => {
      const vessel = createValidVessel({ defaultVariant: 'nonexistent' });
      const result = manager.registerVessel(vessel);

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should throw after dispose', () => {
      manager.dispose();

      expect(() => manager.registerVessel(createValidVessel())).toThrow(
        'VesselManager is disposed',
      );
    });
  });

  describe('unregisterVessel', () => {
    it('should unregister an existing vessel', () => {
      const vessel = createValidVessel();
      manager.registerVessel(vessel);

      const removed = manager.unregisterVessel(vessel.id);

      expect(removed).toEqual(vessel);
      expect(manager.has(vessel.id)).toBe(false);
    });

    it('should return undefined for non-existent vessel', () => {
      const result = manager.unregisterVessel('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should not fire events for non-existent vessel', () => {
      const events: VesselUnregisteredEvent[] = [];
      manager.events.on('vessel_unregistered', (e) => {
        events.push(e);
      });

      manager.unregisterVessel('nonexistent');

      expect(events).toHaveLength(0);
    });

    it('should emit vessel_unregistered event', () => {
      const vessel = createValidVessel();
      manager.registerVessel(vessel);
      const events: VesselUnregisteredEvent[] = [];
      manager.events.on('vessel_unregistered', (e) => {
        events.push(e);
      });

      manager.unregisterVessel(vessel.id);

      expect(events).toHaveLength(1);
      expect(events[0].vesselId).toBe(vessel.id);
      expect(events[0].vessel).toEqual(vessel);
    });

    it('should keep other vessels when unregistering one', () => {
      const vesselA = createValidVessel({ id: 'vessel-a' });
      const vesselB = createValidVessel({ id: 'vessel-b' });
      manager.registerVessel(vesselA);
      manager.registerVessel(vesselB);

      manager.unregisterVessel('vessel-a');

      expect(manager.has('vessel-a')).toBe(false);
      expect(manager.has('vessel-b')).toBe(true);
      expect(manager.get('vessel-b')).toEqual(vesselB);
    });

    it('should throw after dispose', () => {
      manager.dispose();

      expect(() => manager.unregisterVessel('test')).toThrow(
        'VesselManager is disposed',
      );
    });
  });

  describe('get', () => {
    it('should return vessel by id', () => {
      const vessel = createValidVessel();
      manager.registerVessel(vessel);

      expect(manager.get(vessel.id)).toEqual(vessel);
    });

    it('should return same reference identity', () => {
      const vessel = createValidVessel();
      manager.registerVessel(vessel);

      expect(manager.get(vessel.id)).toBe(vessel);
    });

    it('should return undefined for non-existent vessel', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return empty array when no vessels registered', () => {
      expect(manager.getAll()).toEqual([]);
    });

    it('should return all registered vessels', () => {
      const vessel1 = createValidVessel({ id: 'vessel-1' });
      const vessel2 = createValidVessel({ id: 'vessel-2' });
      manager.registerVessel(vessel1);
      manager.registerVessel(vessel2);

      const result = manager.getAll();

      expect(result).toHaveLength(2);
      expect(result.map((v) => v.id)).toContain('vessel-1');
      expect(result.map((v) => v.id)).toContain('vessel-2');
    });

    it('should return a new array (mutation safety)', () => {
      manager.registerVessel(createValidVessel());

      const result1 = manager.getAll();
      const result2 = manager.getAll();

      expect(result1).not.toBe(result2);
      expect(result1).toEqual(result2);
    });
  });

  describe('has', () => {
    it('should return true for registered vessel', () => {
      manager.registerVessel(createValidVessel());
      expect(manager.has('test-vessel')).toBe(true);
    });

    it('should return false for non-existent vessel', () => {
      expect(manager.has('nonexistent')).toBe(false);
    });
  });

  describe('size', () => {
    it('should return 0 when no vessels registered', () => {
      expect(manager.size).toBe(0);
    });

    it('should return correct count after registrations', () => {
      manager.registerVessel(createValidVessel({ id: 'v-1' }));
      manager.registerVessel(createValidVessel({ id: 'v-2' }));

      expect(manager.size).toBe(2);
    });

    it('should decrease after unregister', () => {
      manager.registerVessel(createValidVessel({ id: 'v-1' }));
      manager.registerVessel(createValidVessel({ id: 'v-2' }));
      manager.unregisterVessel('v-1');

      expect(manager.size).toBe(1);
    });
  });

  describe('getRegisteredIds', () => {
    it('should return empty array when no vessels registered', () => {
      expect(manager.getRegisteredIds()).toEqual([]);
    });

    it('should return all registered vessel ids', () => {
      manager.registerVessel(createValidVessel({ id: 'vessel-1' }));
      manager.registerVessel(createValidVessel({ id: 'vessel-2' }));

      const result = manager.getRegisteredIds();

      expect(result).toHaveLength(2);
      expect(result).toContain('vessel-1');
      expect(result).toContain('vessel-2');
    });
  });

  describe('validateOnRegister option', () => {
    it('should skip validation when validateOnRegister is false', () => {
      const noValidationManager = new VesselManager({
        validateOnRegister: false,
      });
      const vessel = createValidVessel({ id: '' });
      const result = noValidationManager.registerVessel(vessel);

      expect(result.valid).toBe(true);
      expect(noValidationManager.has('')).toBe(true);
    });
  });

  describe('events', () => {
    it('should fire vessel_registered with correct payload', () => {
      const vessel = createValidVessel();
      let receivedEvent: VesselRegisteredEvent | undefined;

      manager.events.on('vessel_registered', (e) => {
        receivedEvent = e;
      });
      manager.registerVessel(vessel);

      expect(receivedEvent).toBeDefined();
      expect(receivedEvent?.vessel).toBe(vessel);
      expect(receivedEvent?.timestamp).toBeGreaterThan(0);
    });

    it('should fire vessel_unregistered with correct payload', () => {
      const vessel = createValidVessel();
      manager.registerVessel(vessel);
      let receivedEvent: VesselUnregisteredEvent | undefined;

      manager.events.on('vessel_unregistered', (e) => {
        receivedEvent = e;
      });
      manager.unregisterVessel(vessel.id);

      expect(receivedEvent).toBeDefined();
      expect(receivedEvent?.vesselId).toBe(vessel.id);
      expect(receivedEvent?.vessel).toEqual(vessel);
      expect(receivedEvent?.timestamp).toBeGreaterThan(0);
    });
  });

  describe('dispose', () => {
    it('should clear all listeners and state', () => {
      manager.registerVessel(createValidVessel());

      manager.dispose();

      expect(manager.size).toBe(0);
      expect(manager.getAll()).toEqual([]);
    });

    it('should not fire events after dispose', () => {
      const events: VesselRegisteredEvent[] = [];
      manager.events.on('vessel_registered', (e) => {
        events.push(e);
      });

      manager.dispose();

      // registerVessel throws after dispose, so no events can fire
      expect(events).toHaveLength(0);
    });

    it('should be idempotent', () => {
      expect(() => {
        manager.dispose();
        manager.dispose();
      }).not.toThrow();
    });
  });

  describe('debug mode', () => {
    it('should not throw when debug is enabled', () => {
      const debugManager = new VesselManager({ debug: true });
      const vessel = createValidVessel();

      expect(() => debugManager.registerVessel(vessel)).not.toThrow();
      expect(debugManager.has(vessel.id)).toBe(true);
    });
  });
});
