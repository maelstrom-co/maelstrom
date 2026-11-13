import type { VesselDefinition } from '@maelstrom-co/protocol';

/** Action name → parameter name → the values that parameter accepts. */
export type ActionOptions = Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
>;

/**
 * Returns a copy of `vessel` with `enum` declared on the named action
 * parameters, in every variant that declares the action. Keyed by action
 * rather than by variant because the same action carries the same options
 * wherever it appears.
 *
 * An empty option list leaves the parameter untouched. A key that matches
 * no action or parameter on the vessel warns instead of no-opping silently.
 */
export function withActionOptions<V extends VesselDefinition>(
  vessel: V,
  options: ActionOptions,
): V {
  warnOnUnmatchedOptions(vessel, options);

  const variants = Object.fromEntries(
    Object.entries(vessel.variants).map(([variantName, variant]) => [
      variantName,
      {
        ...variant,
        actions: variant.actions.map((action) => {
          const forAction = options[action.name];
          if (!forAction || !action.parameters) return action;
          return {
            ...action,
            parameters: action.parameters.map((parameter) => {
              const values = forAction[parameter.name];
              if (!values || values.length === 0) return parameter;
              return { ...parameter, enum: [...values] };
            }),
          };
        }),
      },
    ]),
  );

  return { ...vessel, variants } as V;
}

/**
 * Warns when an `options` key names an action or parameter the vessel
 * doesn't actually declare. `ActionOptions` keys are plain strings, so a
 * rename in the vessel definition that isn't mirrored in the caller's
 * `options` object typechecks fine and silently does nothing forever —
 * `withActionOptions` just returns the action/parameter untouched, and the
 * only symptom is the engine inventing values again. This is the runtime
 * guard for that; it deliberately does not try to catch it at the type
 * level.
 */
function warnOnUnmatchedOptions(
  vessel: VesselDefinition,
  options: ActionOptions,
): void {
  const parametersByAction = new Map<string, Set<string>>();
  for (const variant of Object.values(vessel.variants)) {
    for (const action of variant.actions) {
      const names = parametersByAction.get(action.name) ?? new Set<string>();
      for (const parameter of action.parameters ?? []) {
        names.add(parameter.name);
      }
      parametersByAction.set(action.name, names);
    }
  }

  for (const [actionName, parameters] of Object.entries(options)) {
    const knownParameters = parametersByAction.get(actionName);
    if (!knownParameters) {
      console.warn(
        `[withActionOptions] vessel "${vessel.id}": no action named "${actionName}" — this option list has no effect`,
      );
      continue;
    }
    for (const parameterName of Object.keys(parameters)) {
      if (!knownParameters.has(parameterName)) {
        console.warn(
          `[withActionOptions] vessel "${vessel.id}": action "${actionName}" has no parameter named "${parameterName}" — this option list has no effect`,
        );
      }
    }
  }
}
