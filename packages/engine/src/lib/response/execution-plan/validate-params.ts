import type { VesselAction } from '@maelstrom-co/protocol';

import { normalizeActionParameterEnumValue } from '../../action-parameter-enum.js';
import type { ParamValidationIssue } from './types.js';

export function validateParams(
  actionDef: VesselAction,
  params: Readonly<Record<string, unknown>> | undefined,
): ParamValidationIssue[] {
  const parameters = actionDef.parameters ?? [];
  if (parameters.length === 0) {
    return params === undefined || Object.keys(params).length === 0
      ? []
      : [{ kind: 'params_not_allowed' }];
  }

  const issues: ParamValidationIssue[] = [];
  const definitions = new Map(
    parameters.map((parameter) => [parameter.name, parameter]),
  );

  if (params !== undefined) {
    for (const name of Object.keys(params)) {
      if (!definitions.has(name)) {
        issues.push({ kind: 'unknown_parameter', parameter: name });
      }
    }
  }

  for (const parameter of parameters) {
    if (params === undefined || !Object.hasOwn(params, parameter.name)) {
      if (parameter.required !== false) {
        issues.push({
          kind: 'missing_parameter',
          parameter: parameter.name,
        });
      }
      continue;
    }

    const value = params[parameter.name];
    const actual = jsonType(value);
    if (actual !== parameter.type) {
      issues.push({
        kind: 'type_mismatch',
        parameter: parameter.name,
        expected: parameter.type,
        actual,
      });
      continue;
    }

    const normalizedEnum = parameter.enum
      ?.map(normalizeActionParameterEnumValue)
      .filter((allowed) => allowed !== undefined);
    if (
      !enumMatched &&
      !addIssue({ kind: 'enum_violation', parameter: parameter.name })
    ) {
      issues.push({ kind: 'enum_violation', parameter: parameter.name });
    }
  }

  return issues;
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

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return false;
  if (typeof left !== 'object' || typeof right !== 'object') return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]))
    );
  }

  if (!isJsonObject(left) || !isJsonObject(right)) return false;

  const leftRecord = left;
  const rightRecord = right;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        jsonValuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function isJsonObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
