import type { ActionParameter, Vessel } from '@maelstrom-co/protocol';
import {
  MAX_ACTION_PARAMETER_ENUM_CANDIDATES,
  sanitizeControlChars,
} from '@maelstrom-co/protocol';

/** One Action parameter enum value, normalized once for a request. */
export interface NormalizedActionParameterEnumValue {
  /** Sanitized JSON literal displayed verbatim in the Engine prompt. */
  readonly serialized: string;
  /** Detached, recursively frozen JSON value used for runtime comparison. */
  readonly value: unknown;
}

/**
 * Immutable, request-scoped enum candidates keyed by parameter definition
 * object. Read it with `enumSnapshotFor(ctx, vessels)`, which returns it only
 * when `vessels` is the catalog it was captured from.
 */
export interface ActionParameterEnumSnapshot {
  /**
   * Returns the normalized candidates captured for this exact parameter
   * definition. An empty result means the parameter has no constraining,
   * type-compatible JSON enum values.
   */
  get(
    parameter: ActionParameter,
  ): readonly NormalizedActionParameterEnumValue[];
}

const EMPTY_ENUM_VALUES: readonly NormalizedActionParameterEnumValue[] =
  Object.freeze([]);

/**
 * Returns a sanitized prompt literal and its detached, immutable runtime value,
 * or `undefined` when JSON serialization fails or changes the declared type.
 */
export function normalizeActionParameterEnumValue(
  value: unknown,
  expectedType: ActionParameter['type'],
): NormalizedActionParameterEnumValue | undefined {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (json === undefined) return undefined;

  const serialized = sanitizeControlChars(json);
  const normalized: unknown = JSON.parse(serialized);
  if (jsonType(normalized) !== expectedType) return undefined;

  return Object.freeze({ serialized, value: freezeJsonValue(normalized) });
}

/**
 * Normalizes every Action enum once for one Engine request.
 *
 * The snapshot is detached from author-owned enum objects and recursively
 * frozen. A parameter object reused by reference is still normalized once.
 * Duplicate parameter names and declarations above the protocol's candidate
 * ceiling throw before prompt construction or adapter invocation. Empty or
 * fully filtered enums remain unconstrained beyond the declared type.
 */
export function buildActionParameterEnumSnapshot(
  vessels: readonly Vessel[],
): ActionParameterEnumSnapshot {
  const valuesByParameter = new WeakMap<
    ActionParameter,
    readonly NormalizedActionParameterEnumValue[]
  >();

  for (const vessel of vessels) {
    for (const variant of Object.values(vessel.variants)) {
      for (const action of variant.actions) {
        const parameterNames = new Set<string>();
        for (const parameter of action.parameters ?? []) {
          if (parameterNames.has(parameter.name)) {
            throw new Error(
              'Invalid Action parameter definitions: duplicate parameter name',
            );
          }
          parameterNames.add(parameter.name);

          if (valuesByParameter.has(parameter)) continue;

          const candidates = parameter.enum ?? [];
          if (candidates.length > MAX_ACTION_PARAMETER_ENUM_CANDIDATES) {
            throw new Error(
              'Invalid Action parameter definitions: enum candidate limit exceeded',
            );
          }
          const normalized = candidates
            .map((candidate) =>
              normalizeActionParameterEnumValue(candidate, parameter.type),
            )
            .filter(
              (candidate): candidate is NormalizedActionParameterEnumValue =>
                candidate !== undefined,
            );
          valuesByParameter.set(parameter, Object.freeze(normalized));
        }
      }
    }
  }

  return Object.freeze({
    get: (parameter: ActionParameter) =>
      valuesByParameter.get(parameter) ?? EMPTY_ENUM_VALUES,
  });
}

function freezeJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;

  const pending: object[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || Object.isFrozen(current)) continue;
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === 'object') pending.push(child);
    }
    Object.freeze(current);
  }
  return value;
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
