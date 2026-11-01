import type { LoadedCase } from '../../packages/evals/src/adapters/offline-case.js';
import type { Scenario } from '../../packages/evals/src/core/scenarios.js';

/**
 * Builds a read-only metadata inventory. Only definition.scenarioId links cases;
 * lineage references are not links or evidence of coverage or migration.
 */
export function buildInventoryReport(
  scenarios: readonly Pick<Scenario, 'id'>[],
  cases: readonly {
    readonly definition: Pick<
      LoadedCase['definition'],
      'id' | 'fixtureId' | 'profile' | 'scenarioId'
    >;
  }[],
  jsonBackedScenarioIds: readonly string[],
) {
  const currentScenarioIds = [...new Set(scenarios.map(({ id }) => id))].sort();
  const currentIds = new Set(currentScenarioIds);
  const jsonBackedIds = new Set(jsonBackedScenarioIds);
  const currentJsonBackedScenarioIds = currentScenarioIds.filter((id) =>
    jsonBackedIds.has(id),
  );
  const typescriptBackedNotYetJsonSnapshottedScenarioIds =
    currentScenarioIds.filter((id) => !jsonBackedIds.has(id));
  const caseScenarioReferences = cases
    .flatMap(({ definition }) =>
      definition.scenarioId === undefined
        ? []
        : [{ caseId: definition.id, scenarioId: definition.scenarioId }],
    )
    .sort((a, b) => a.caseId.localeCompare(b.caseId));
  const linkedCurrentScenarioIds = [
    ...new Set(
      caseScenarioReferences
        .filter(({ scenarioId }) => currentIds.has(scenarioId))
        .map(({ scenarioId }) => scenarioId),
    ),
  ].sort();
  const linkedIds = new Set(linkedCurrentScenarioIds);

  return {
    interpretation:
      'definition.scenarioId is a metadata reference only, not proof of request/catalog/oracle migration or scenario coverage. lineage[].scenarioId is excluded. Multiple cases may link to one scenario; unmapped scenarios are informational. Source format is independent of case links and does not prove coverage.',
    counts: {
      currentScenarios: scenarios.length,
      jsonBackedScenarios: currentJsonBackedScenarioIds.length,
      typescriptBackedNotYetJsonSnapshottedScenarios:
        typescriptBackedNotYetJsonSnapshottedScenarioIds.length,
      cases: cases.length,
      fixtures: new Set(cases.map(({ definition }) => definition.fixtureId))
        .size,
      uniqueProfiles: new Set(cases.map(({ definition }) => definition.profile))
        .size,
      caseScenarioReferences: caseScenarioReferences.length,
      linkedCurrentScenarios: linkedCurrentScenarioIds.length,
    },
    currentScenarioIds,
    jsonBackedScenarioIds: currentJsonBackedScenarioIds,
    typescriptBackedNotYetJsonSnapshottedScenarioIds,
    staleJsonBackedScenarioIds: [...jsonBackedIds]
      .filter((id) => !currentIds.has(id))
      .sort(),
    caseScenarioReferences,
    linkedCurrentScenarioIds,
    currentScenarioIdsWithoutCaseLink: currentScenarioIds.filter(
      (id) => !linkedIds.has(id),
    ),
    unknownCaseScenarioReferences: caseScenarioReferences.filter(
      ({ scenarioId }) => !currentIds.has(scenarioId),
    ),
  };
}
