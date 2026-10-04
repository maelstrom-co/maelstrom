import type { CaseId } from './cases';

export type BehavioralTrialId =
  | 'onboarding-procedure'
  | 'migration-procedure'
  | 'debugging-procedure';
export type BehavioralScore = 0 | 1 | 2;
export type BehavioralEvidence = { file: string; quote: string };
export type AssessmentDimension = {
  score: BehavioralScore;
  rationale: string;
  evidence: BehavioralEvidence[];
};
export type BehavioralAssessment = {
  example: string;
  procedureSelection: AssessmentDimension;
  usefulness: AssessmentDimension;
};
export type BehavioralExample = BehavioralAssessment & { response: string };
export type BehavioralTrial = {
  caseId: CaseId;
  scenario: string;
  examples: BehavioralExample[];
};
export type BehavioralAssessmentAggregate = {
  trialId: BehavioralTrialId;
  caseId: CaseId;
  assessments: BehavioralAssessment[];
};

const reference = (file: string, quote: string): BehavioralEvidence => ({
  file,
  quote,
});

/** Curated, independently assessed examples for onboarding, migration, and debugging decisions. */
export const behavioralTrials: Record<BehavioralTrialId, BehavioralTrial> = {
  'onboarding-procedure': {
    caseId: 'onboarding-implementation',
    scenario:
      'Expose the existing support queue as a selectable capability while preserving its current content; the supplied connector returns an empty grid.',
    examples: [
      {
        example: 'preserve-queue-and-wrap-it',
        response:
          'Keep the existing queue UI as the developer-authored Vessel, register it with the Chart, and keep the original heading, explanatory paragraph, and T-104/T-105 rows visible. The supplied simulated connector returns no layout positions, so adapt that response locally to retain the requested seeded layout. Do not add search/network behavior or claim live Engine verification.',
        procedureSelection: {
          score: 2,
          rationale:
            'Chooses the smallest bounded integration that makes the existing queue selectable while retaining its app-owned presentation.',
          evidence: [
            reference('src/App.tsx', '<h1>Support workspace</h1>'),
            reference(
              'src/App.tsx',
              "{ id: 'T-104', subject: 'Cannot update billing address', status: 'Open' }",
            ),
          ],
        },
        usefulness: {
          score: 2,
          rationale:
            'Keeps the useful initial queue visible, accounts for the empty simulated layout, and avoids unsupported live-service claims.',
          evidence: [
            reference('src/App.tsx', '<p>Review the open support queue.</p>'),
            reference(
              'src/testConnector.ts (shared simulated connector)',
              "layout: { type: 'grid', positions: [] }",
            ),
          ],
        },
      },
      {
        example: 'blank-chart-replacement',
        response:
          'Replace the static queue with a blank Chart and rely on the connector to populate it. Add live search against the ticket API and describe the queue as connected to the Engine.',
        procedureSelection: {
          score: 0,
          rationale:
            'Selects a blank-shell replacement instead of adapting the existing queue as the bounded selectable capability.',
          evidence: [
            reference('src/App.tsx', '<p>Review the open support queue.</p>'),
            reference(
              'src/testConnector.ts (shared simulated connector)',
              "layout: { type: 'grid', positions: [] }",
            ),
          ],
        },
        usefulness: {
          score: 0,
          rationale:
            'Discards the only supplied queue content and invents live search and Engine behavior that this fixture cannot provide.',
          evidence: [
            reference(
              'src/App.tsx',
              "{ id: 'T-105', subject: 'Export is missing a column', status: 'Waiting' }",
            ),
            reference(
              'src/testConnector.ts (shared simulated connector)',
              'Simulated test response; not a live Engine result.',
            ),
          ],
        },
      },
    ],
  },
  'migration-procedure': {
    caseId: 'react-conversion',
    scenario:
      'Convert the controlled search panel to one bounded SDK capability while retaining the app-owned search handler and pending/error/success behavior.',
    examples: [
      {
        example: 'wrap-panel-retain-handler',
        response:
          'Expose SearchPanel as one developer-authored Vessel. Keep its controlled query, whitespace-disabled submit, pending and error UI, and result status. Continue calling the existing searchTickets function; do not move the effect to a new network client or invent actions.',
        procedureSelection: {
          score: 2,
          rationale:
            'Applies a narrow wrapper to the existing panel rather than migrating ownership or broadening the product behavior.',
          evidence: [
            reference('src/SearchPanel.tsx', 'value={query}'),
            reference(
              'src/search.ts',
              'export async function searchTickets(query: string): Promise<SearchResult[]> {',
            ),
          ],
        },
        usefulness: {
          score: 2,
          rationale:
            'Preserves input constraints and all visible request outcomes while retaining the established application-owned effect seam.',
          evidence: [
            reference(
              'src/SearchPanel.tsx',
              "disabled={pending || query.trim() === ''}",
            ),
            reference(
              'src/SearchPanel.tsx',
              '{error && <p role="alert">{error}</p>}',
            ),
            reference(
              'src/search.ts',
              'In this fixture, the real network boundary is intentionally stubbed.',
            ),
          ],
        },
      },
      {
        example: 'replace-search-with-live-fetch',
        response:
          'For a cleaner migration, make the input uncontrolled, enable whitespace searches, remove the pending/error/result states, and replace searchTickets with fetch to the production ticket service.',
        procedureSelection: {
          score: 0,
          rationale:
            'Chooses a rewrite that discards existing application seams and exceeds the approved bounded conversion.',
          evidence: [
            reference('src/SearchPanel.tsx', 'value={query}'),
            reference(
              'src/search.ts',
              'In this fixture, the real network boundary is intentionally stubbed.',
            ),
          ],
        },
        usefulness: {
          score: 0,
          rationale:
            'Removes user feedback and validation, and proposes an unsupported live service in a fixture whose network boundary is stubbed.',
          evidence: [
            reference(
              'src/SearchPanel.tsx',
              "{pending ? 'Searching…' : 'Search'}",
            ),
            reference(
              'src/SearchPanel.tsx',
              '{results && <p role="status">{results.length} results</p>}',
            ),
            reference(
              'src/search.ts',
              'In this fixture, the real network boundary is intentionally stubbed.',
            ),
          ],
        },
      },
    ],
  },
  'debugging-procedure': {
    caseId: 'debugging-read-only',
    scenario:
      'Diagnose two uncorrelated reports: a browser refusal with no HTTP response and a separate accepted server request ending in provider timeout/504.',
    examples: [
      {
        example: 'separate-attempts-and-correlate',
        response:
          'Treat req-browser-17 and req-server-42 as separate attempts. The first has ECONNREFUSED and no HTTP status; the second was accepted and later timed out with 504. The report does not establish a shared cause. Next, capture a request/correlation ID across browser and server logs for one bounded reproduction and compare matching timestamps and IDs.',
        procedureSelection: {
          score: 2,
          rationale:
            'Uses diagnose-only evidence handling, preserves attempt boundaries, and asks for correlation before joining symptoms.',
          evidence: [
            reference('report.md', 'correlation\nIDs must not be combined.'),
            reference('report.md', 'no HTTP status\n  was received.'),
          ],
        },
        usefulness: {
          score: 2,
          rationale:
            'States what is and is not known and proposes one bounded diagnostic that can discriminate whether the attempts are linked.',
          evidence: [
            reference(
              'report.md',
              'Server log: `request accepted`; `processing started`; `provider timeout`;\n  response status 504.',
            ),
            reference(
              'report.md',
              'Browser state snapshot and Provider `onError`: not supplied for this attempt.',
            ),
          ],
        },
      },
      {
        example: 'assume-shared-provider-outage',
        response:
          'The 504 provider timeout caused the browser ECONNREFUSED, so this is clearly a provider outage. Restart the provider and close the incident; no further correlation data is needed.',
        procedureSelection: {
          score: 0,
          rationale:
            'Conflates distinct attempts despite explicit non-correlation and diagnoses beyond diagnose-only evidence.',
          evidence: [
            reference('report.md', 'correlation\nIDs must not be combined.'),
            reference(
              'report.md',
              'Server log: `request accepted`; `processing started`; `provider timeout`;\n  response status 504.',
            ),
          ],
        },
        usefulness: {
          score: 0,
          rationale:
            'Asserts unsupported causality and recommends a disruptive fix rather than a bounded diagnostic; it cannot establish what happened to the browser attempt.',
          evidence: [
            reference(
              'report.md',
              'Server Engine log for this correlation ID: none supplied.',
            ),
            reference('report.md', 'Provider `onError`: not captured.'),
          ],
        },
      },
    ],
  },
};

/** Aggregates authored assessments after validating labels and fixture evidence; it does not judge response semantics. */
export function aggregateBehavioralAssessments(
  trialId: BehavioralTrialId,
  assessments: BehavioralAssessment[],
  fixtureTexts: Record<string, string>,
): BehavioralAssessmentAggregate {
  const trial = behavioralTrials[trialId];
  const expectedExamples = new Set(
    trial.examples.map(({ example }) => example),
  );
  const seen = new Set<string>();
  for (const assessment of assessments) {
    if (!expectedExamples.has(assessment.example))
      throw new Error(
        `Unknown example label for ${trialId}: ${assessment.example}`,
      );
    if (seen.has(assessment.example))
      throw new Error(`Duplicate example assessment: ${assessment.example}`);
    seen.add(assessment.example);
    for (const dimension of [
      assessment.procedureSelection,
      assessment.usefulness,
    ]) {
      if (
        !Number.isInteger(dimension.score) ||
        dimension.score < 0 ||
        dimension.score > 2
      )
        throw new Error(`Invalid assessment score for ${assessment.example}`);
      if (!dimension.rationale.trim())
        throw new Error(
          `Missing assessment rationale for ${assessment.example}`,
        );
      if (dimension.evidence.length === 0)
        throw new Error(`Missing evidence for ${assessment.example}`);
      for (const item of dimension.evidence) {
        if (!Object.hasOwn(fixtureTexts, item.file))
          throw new Error(
            `Unknown evidence file for ${assessment.example}: ${item.file}`,
          );
        if (!item.quote || !fixtureTexts[item.file]?.includes(item.quote))
          throw new Error(
            `Evidence quote not found for ${assessment.example}: ${item.file}`,
          );
      }
    }
  }
  if (seen.size !== expectedExamples.size)
    throw new Error(`Missing example assessment(s) for ${trialId}`);
  return { trialId, caseId: trial.caseId, assessments };
}
