import type { ChartSize } from './chart.js';

/** Definition of a Vessel as a state machine */
export interface Vessel {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic description for the LLM to understand purpose */
  description: string;
  /** The variant to start in */
  defaultVariant: string;
  /** Available variants (states) */
  variants: Record<string, VesselVariant>;
}

/** A variant represents a distinct state of the Vessel */
export interface VesselVariant {
  /** State properties for this variant */
  props: Record<string, unknown>;
  /** Minimum size required to display this variant */
  minSize: ChartSize;
  /** Actions available when in this variant */
  actions: VesselAction[];
}

/** An action that can be invoked on a Vessel */
export interface VesselAction {
  /** Action identifier (unique within the variant) */
  name: string;
  /** Description for the LLM */
  description: string;
  /** Parameter definitions */
  parameters?: ActionParameter[];
  /** Target variant after this action executes. Undefined = no state change */
  transitionsTo?: string;
}

/** Parameter definition for an action */
export interface ActionParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;
  defaultValue?: unknown;
  enum?: unknown[];
}
