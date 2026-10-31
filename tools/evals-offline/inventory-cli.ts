import {
  buildLegacyAccounting,
  loadLegacyObligations,
} from '../../packages/evals/src/core/legacy-obligations.js';
import {
  jsonBackedScenarioIds,
  scenarios,
} from '../../packages/evals/src/core/scenarios.js';
import { loadOfflineCases } from './cases.js';
import { buildInventoryReport } from './inventory.js';

const cases = loadOfflineCases();

console.log(
  JSON.stringify(
    {
      ...buildInventoryReport(scenarios, cases, jsonBackedScenarioIds),
      legacy: buildLegacyAccounting(cases, loadLegacyObligations()),
    },
    null,
    2,
  ),
);
