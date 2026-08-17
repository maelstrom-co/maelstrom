import type { VesselAction } from '@maelstrom-co/protocol';
import { MAX_ACTION_PARAMETER_ENUM_CANDIDATES } from '@maelstrom-co/protocol';

import type { ActionParameterEnumSnapshot } from '../../action-parameter-enum.js';
import {
  MAX_ACTION_PARAM_COMPARISON_UNITS,
  MAX_ACTION_PARAM_ISSUES,
} from '../../model-output-limits.js';
import type { ParamsLimitKind, ParamValidationIssue } from './types.js';

/** Bounded validation outcome; limit arms intentionally retain no parameter metadata. */
export type ParamValidationResult =
  | { readonly kind: 'valid' }
  | {
      readonly kind: 'invalid';
      readonly issues: readonly ParamValidationIssue[];
    }
  | { readonly kind: 'limit'; readonly limit: ParamsLimitKind };

/**
 * Validates model-authored params against the prompt-visible enum snapshot.
 * Enum comparison work is iterative and shared across all candidates and
 * parameters for the Action. A seventeenth issue replaces all ordinary issues
 * with a fixed limit result. An empty or fully filtered snapshot imposes no
 * enum constraint beyond the declared type. `defaultValue` is metadata and is
 * not applied here; this Engine-planning boundary does not validate local
 * Action invocations, whose validation and fallbacks belong to the runner.
 */
export function validateParams(
  actionDef: VesselAction,
  params: Readonly<Record<string, unknown>> | undefined,
  enumSnapshot: ActionParameterEnumSnapshot,
): ParamValidationResult {
  const parameters = actionDef.parameters ?? [];
  if (parameters.length === 0) {
    return params === undefined || Object.keys(params).length === 0
      ? { kind: 'valid' }
      : { kind: 'invalid', issues: [{ kind: 'params_not_allowed' }] };
  }

  const issues: ParamValidationIssue[] = [];
  const comparisonBudget = { used: 0 };
  const addIssue = (issue: ParamValidationIssue): boolean => {
    if (issues.length === MAX_ACTION_PARAM_ISSUES) return false;
    issues.push(issue);
    return true;
  };
  const definitions = new Map(
    parameters.map((parameter) => [parameter.name, parameter]),
  );

  if (params !== undefined) {
    for (const name of Object.keys(params)) {
      if (!definitions.has(name)) {
        if (!addIssue({ kind: 'unknown_parameter', parameter: name })) {
          return { kind: 'limit', limit: 'validation_issues' };
        }
      }
    }
  }

  for (const parameter of parameters) {
    if (params === undefined || !Object.hasOwn(params, parameter.name)) {
      if (parameter.required !== false) {
        if (
          !addIssue({
            kind: 'missing_parameter',
            parameter: parameter.name,
          })
        ) {
          return { kind: 'limit', limit: 'validation_issues' };
        }
      }
      continue;
    }

    const value = params[parameter.name];
    const actual = jsonType(value);
    if (actual !== parameter.type) {
      if (
        !addIssue({
          kind: 'type_mismatch',
          parameter: parameter.name,
          expected: parameter.type,
          actual,
        })
      ) {
        return { kind: 'limit', limit: 'validation_issues' };
      }
      continue;
    }

    const normalizedEnum = enumSnapshot.get(parameter);
    let enumMatched = normalizedEnum.length === 0;
    for (const allowed of normalizedEnum) {
      const equality = jsonValuesEqual(value, allowed.value, comparisonBudget);
      if (equality === 'limit') {
        return { kind: 'limit', limit: 'comparison_work' };
      }
      if (equality) {
        enumMatched = true;
        break;
      }
    }
    if (
      !enumMatched &&
      !addIssue({ kind: 'enum_violation', parameter: parameter.name })
    ) {
      return { kind: 'limit', limit: 'validation_issues' };
    }
  }

  return issues.length === 0 ? { kind: 'valid' } : { kind: 'invalid', issues };
}

/** Detects ambiguous parameter names without constructing a last-wins map. */
export function hasDuplicateActionParameterDefinitions(
  actionDef: VesselAction,
): boolean {
  const names = new Set<string>();
  for (const parameter of actionDef.parameters ?? []) {
    if (names.has(parameter.name)) return true;
    names.add(parameter.name);
  }
  return false;
}

/** Detects definitions that bypassed the protocol's authoring validation. */
export function hasInvalidActionParameterDefinitions(
  actionDef: VesselAction,
): boolean {
  return (
    hasDuplicateActionParameterDefinitions(actionDef) ||
    (actionDef.parameters ?? []).some(
      (parameter) =>
        (parameter.enum?.length ?? 0) > MAX_ACTION_PARAMETER_ENUM_CANDIDATES,
    )
  );
}

function jsonType(value: unknown): ParamValidationIssueActualType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as ParamValidationIssueActualType;
}

type ParamValidationIssueActualType = Extract<
  ParamValidationIssue,
  { kind: 'type_mismatch' }
>['actual'];

/**
 * Compares JSON values with deterministic LIFO pair accounting. Pair 8,192 is
 * processed; a later attempted pop returns `limit` before inspecting the pair.
 */
function jsonValuesEqual(
  left: unknown,
  right: unknown,
  budget: { used: number },
): boolean | 'limit' {
  const pending: Array<{ left: unknown; right: unknown }> = [{ left, right }];
  while (pending.length > 0) {
    if (budget.used === MAX_ACTION_PARAM_COMPARISON_UNITS) return 'limit';
    const pair = pending.pop();
    if (pair === undefined) break;
    budget.used += 1;

    if (Object.is(pair.left, pair.right)) continue;
    if (pair.left === null || pair.right === null) return false;
    if (typeof pair.left !== 'object' || typeof pair.right !== 'object') {
      return false;
    }

    if (Array.isArray(pair.left) || Array.isArray(pair.right)) {
      if (
        !Array.isArray(pair.left) ||
        !Array.isArray(pair.right) ||
        pair.left.length !== pair.right.length
      ) {
        return false;
      }
      for (let index = pair.left.length - 1; index >= 0; index -= 1) {
        pending.push({ left: pair.left[index], right: pair.right[index] });
      }
      continue;
    }

    if (!isJsonObject(pair.left) || !isJsonObject(pair.right)) return false;
    const leftRecord = pair.left;
    const rightRecord = pair.right;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    if (
      leftKeys.length !== rightKeys.length ||
      leftKeys.some((key) => !Object.hasOwn(rightRecord, key))
    ) {
      return false;
    }
    for (let index = leftKeys.length - 1; index >= 0; index -= 1) {
      const key = leftKeys[index] as string;
      pending.push({ left: leftRecord[key], right: rightRecord[key] });
    }
  }
  return true;
}

function isJsonObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
