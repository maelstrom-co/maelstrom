import type { Vessel, VesselDefinition } from '@maelstrom-co/protocol';
import { validateVessel } from '@maelstrom-co/protocol';

import type { MaelstromContextPair, MaelstromContextValue } from './context.js';
import { requireContext } from './require-context.js';
import type {
  AnyVesselEntry,
  UpdateVesselConflict,
  UpdateVesselPayload,
  UpdateVesselResult,
  VesselIds,
} from './vessel-entry-types.js';

/** Identifies which public API triggered a republish, for error messages. */
type RepublishCaller = 'updateVessel' | 'handle.update';

/**
 * Runtime guards + republish shared by `m.updateVessel()` and
 * `handle.update()` — the two call sites differ only in how `Id`/`V` gets
 * checked at compile time before this ever runs, so the resolved-context
 * caller passes in an already-`requireContext`'d `ctx`.
 */
export function republishVesselDefinition(
  ctx: MaelstromContextValue,
  vessel: VesselDefinition,
  caller: RepublishCaller,
): UpdateVesselResult {
  const vesselId: string = vessel.id;

  // Without this guard a typo'd id silently installs a definition with no
  // component behind it, and the only symptom is a render-time warning.
  const registered = ctx.orchestrator.vesselManager.get(vesselId);
  if (!registered) {
    // A vessel id reachable through `Id extends VesselIds<T>` can only ever
    // be one declared in `createMaelstrom({ vessels })` — a runtime id from
    // `registerVessel()` can never satisfy that constraint — so the two
    // callers need different remediation.
    const remediation =
      caller === 'updateVessel'
        ? 'Register it via createMaelstrom({ vessels }) first.'
        : "This handle's vessel is no longer registered — call m.registerVessel() again to get a handle for the current registration.";
    throw new Error(
      `[Maelstrom] ${caller}: vessel "${vesselId}" is not registered. ${remediation}`,
    );
  }

  const validation = validateVessel(vessel);
  if (!validation.valid) {
    const messages = validation.issues.map((i) => i.message).join(', ');
    throw new Error(
      `[Maelstrom] ${caller}: vessel "${vesselId}" failed validation: ${messages}`,
    );
  }

  // CommandProcessor applies set_layout/execute_actions through an async
  // queue, so a batch already queued or in flight can land an instance on a
  // variant this republish is about to drop — after the scan below reads
  // its point-in-time snapshot. Checked before the scan, not just before
  // the commit, so a stale snapshot never passes the guard it exists to
  // defeat.
  const { commandProcessor } = ctx.orchestrator;
  if (
    commandProcessor.store.state.status !== 'idle' ||
    commandProcessor.queueLength > 0
  ) {
    return {
      ok: false,
      conflict: {
        code: 'batch_in_flight',
        vesselId: validation.vessel.id,
        message: `[Maelstrom] ${caller}: vessel "${vesselId}" has a command batch already queued or in flight, so the instance snapshot cannot be trusted. Retry once it settles (e.g. on the next render, or after the current intent or action resolves).`,
      },
    };
  }

  // A republish that drops a variant a live instance's current variant is
  // missing from, or drops an action that variant still declares, would
  // otherwise leave that instance unusable with only a console warning —
  // neither path throws, so the caller has nothing to catch. Scanned
  // against the now-validated definition and checked before the commit
  // below, so a rejected republish never half-applies.
  const conflict = checkForStrandedInstances(
    ctx,
    registered,
    validation.vessel,
    caller,
  );
  if (conflict) {
    return { ok: false, conflict };
  }

  // vesselManager.registerVessel zod-parses `vessel` a second time —
  // validateVessel above already had to parse it because the conflict scan
  // needs `validation.vessel` — but the duplicate deep parse is accepted so
  // VesselManager stays the single place that commits a definition to the
  // store.
  const registerResult = ctx.orchestrator.vesselManager.registerVessel(vessel);
  // Unreachable today: validateVessel above already validated this exact
  // object, so registerResult can't be invalid here. Kept as a guard
  // against future drift if VesselManager.registerVessel grows a check
  // this path doesn't already run.
  if (!registerResult.valid) {
    const messages = registerResult.issues.map((i) => i.message).join(', ');
    throw new Error(
      `[Maelstrom] ${caller}: vessel "${vesselId}" failed validation: ${messages}`,
    );
  }
  return { ok: true };
}

/**
 * Factory that creates m.updateVessel() bound to a specific Maelstrom context.
 *
 * Component registries are deliberately untouched — that is what keeps
 * stateful components alive across a republish.
 */
export function createUpdateVessel<T extends readonly AnyVesselEntry[]>(
  contextPair: MaelstromContextPair,
) {
  const { contextRef } = contextPair;

  return function updateVessel<Id extends VesselIds<T>>(
    vessel: UpdateVesselPayload<T, Id>,
  ): UpdateVesselResult {
    const ctx = requireContext(contextRef, 'updateVessel');
    return republishVesselDefinition(ctx, vessel, 'updateVessel');
  };
}

/**
 * Returns a {@link UpdateVesselConflict} if `newVessel` would strand a live
 * instance of `newVessel.id`: either its current variant is gone, or that
 * variant no longer declares an action `oldVessel` had for it. Returns
 * `null` if no live instance is stranded.
 */
function checkForStrandedInstances(
  ctx: MaelstromContextValue,
  oldVessel: Vessel,
  newVessel: Vessel,
  caller: RepublishCaller,
): UpdateVesselConflict | null {
  const { instances } = ctx.orchestrator.commandProcessor.store.state;
  for (const instance of instances.values()) {
    if (instance.vesselId !== newVessel.id) continue;

    // `Object.hasOwn` rather than truthiness on indexed access — a variant
    // name like `'toString'` would resolve to `Object.prototype.toString`
    // (truthy) and silently slip past this existence check.
    if (!Object.hasOwn(newVessel.variants, instance.variant)) {
      return {
        code: 'variant_dropped',
        vesselId: newVessel.id,
        instanceId: instance.instanceId,
        variant: instance.variant,
        message: `[Maelstrom] ${caller}: instance "${instance.instanceId}" is on variant "${instance.variant}", which the new definition for "${newVessel.id}" does not declare.`,
      };
    }

    const oldActionNames =
      oldVessel.variants[instance.variant]?.actions.map((a) => a.name) ?? [];
    const newActionNames = new Set(
      newVessel.variants[instance.variant].actions.map((a) => a.name),
    );
    const missingActionNames = oldActionNames.filter(
      (name) => !newActionNames.has(name),
    );

    if (missingActionNames.length > 0) {
      const plural = missingActionNames.length === 1 ? '' : 's';
      return {
        code: 'action_dropped',
        vesselId: newVessel.id,
        instanceId: instance.instanceId,
        variant: instance.variant,
        missingActionNames,
        message: `[Maelstrom] ${caller}: instance "${instance.instanceId}" is on variant "${instance.variant}" of "${newVessel.id}", which no longer declares action${plural} "${missingActionNames.join('", "')}".`,
      };
    }
  }
  return null;
}
