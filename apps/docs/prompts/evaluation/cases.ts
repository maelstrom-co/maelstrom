import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePromptSource } from '../../tools/prompts/library';

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = join(docsRoot, 'prompts/acceptance/fixtures');

export type CaseId =
  | 'onboarding-implementation'
  | 'modeling-read-only'
  | 'react-inventory'
  | 'react-conversion'
  | 'debugging-read-only';

type FixtureFile = { source: string; path: string; fixture?: string };
type CaseDefinition = {
  promptId: string;
  fixture: string;
  mode: 'read-only' | 'implementation';
  goal: string;
  task: string;
  rubric: string[];
  files: FixtureFile[];
};

/** Repository-owned behavioral cases. Canonical prompt markdown is never mutated. */
export const caseRegistry: Record<CaseId, CaseDefinition> = {
  'onboarding-implementation': {
    promptId: 'maelstrom-project-onboarding',
    fixture: 'onboarding-react',
    mode: 'implementation',
    goal: 'Integrate Maelstrom into the supplied React application to expose its existing support-ticket queue as a selectable capability.',
    task: 'Implement the smallest bounded Maelstrom React integration for the existing queue. Preserve the exact heading, explanatory paragraph, and initial T-104/T-105 ticket rows. Use only the supplied simulated connector; its stub returns an empty grid, so wrap it in an App-local response adapter that preserves the current requested layout for the Chart visibility check. Do not edit src/testConnector.ts. Give the Chart a parent with explicit nonzero height (Chart fills its parent). Do not add or claim search behavior, network behavior, or live Engine verification. The app starts at src/main.tsx and package.json.fixture is staged as package.json.',
    rubric: [
      'Use the installed SDK public API and keep the queue as an application-authored Vessel.',
      'Rendered heading, explanatory paragraph, and both initial ticket rows remain visible.',
      'A real Chart renders a registered Vessel instance with nonzero, visible geometry in a real browser.',
      'No live Engine/provider behavior is claimed.',
    ],
    files: [
      {
        source: 'package.json.fixture',
        path: 'package.json (staged from package.json.fixture)',
      },
      {
        source: 'project.json.fixture',
        path: 'project.json (staged from project.json.fixture)',
      },
      { source: 'tsconfig.json', path: 'tsconfig.json' },
      { source: 'vite.config.ts', path: 'vite.config.ts' },
      { source: 'index.html', path: 'index.html' },
      { source: 'src/main.tsx', path: 'src/main.tsx' },
      { source: 'src/App.tsx', path: 'src/App.tsx' },
      {
        source: 'src/testConnector.ts',
        path: 'src/testConnector.ts (shared simulated connector)',
        fixture: 'migration-react',
      },
    ],
  },
  'modeling-read-only': {
    promptId: 'maelstrom-vessel-modeling',
    fixture: 'modeling-react',
    mode: 'read-only',
    goal: 'Inventory the observed support-queue capability and propose a bounded Vessel contract.',
    task: 'Inventory src/Queue.tsx behavior and give an evidence-backed Vessel proposal. Do not edit files.',
    rubric: [
      'Ground filtering, reset, no-match, and ticket-list observations in source evidence.',
      'Decide whether one cohesive queue is a useful selectable capability; reject unsupported states/actions.',
      'Identify unknowns rather than inventing product or SDK behavior.',
    ],
    files: [{ source: 'src/Queue.tsx', path: 'src/Queue.tsx' }],
  },
  'react-inventory': {
    promptId: 'maelstrom-react-inventory',
    fixture: 'migration-react',
    mode: 'read-only',
    goal: 'Assess whether the supplied ticket search panel is a useful bounded Maelstrom Vessel pilot.',
    task: 'Inventory the existing SearchPanel without editing. Trace controlled input, disabled empty/whitespace submission, pending/error/success UI, and the application-owned searchTickets handler. Propose or reject a bounded pilot with source evidence; do not implement it.',
    rubric: [
      'Ground controlled input and empty/whitespace-submit behavior in source evidence.',
      'Ground pending, error, and success branches in source evidence.',
      'Keep searchTickets and external-effect ownership in the application.',
      'Remain an inventory/proposal, not an implementation; distinguish observed facts from inference.',
    ],
    files: [
      { source: 'src/SearchPanel.tsx', path: 'src/SearchPanel.tsx' },
      { source: 'src/search.ts', path: 'src/search.ts' },
    ],
  },
  'react-conversion': {
    promptId: 'maelstrom-react-conversion',
    fixture: 'migration-react',
    mode: 'implementation',
    goal: 'Convert the supplied controlled ticket-search panel into a bounded SDK capability while preserving its UI and application-owned search function.',
    task: 'Approved plan: expose only the existing SearchPanel as one developer-authored Vessel with its current behavior. Keep the named SearchPanel export at src/SearchPanel.tsx and keep calling the existing named searchTickets handler from src/search.ts; these are the public app-owned seams exercised by the trusted grader, not hidden grader APIs. The supplied simulated connector returns an empty grid; wrap it in an App-local response adapter that preserves the current requested layout so the test Chart retains its seeded instance. Do not edit src/testConnector.ts. Give the Chart a parent with explicit nonzero height (Chart fills its parent). Do not add network behavior, API calls, invented states/actions, or live Engine claims. Preserve src/SearchPanel.test.tsx and all .trial evaluator support files. The application shell and simulated connector are supplied.',
    rubric: [
      'Pass the candidate project typecheck using the supplied SDK version.',
      'Preserve controlled input, disabled empty/whitespace submit, pending, error, and success UI.',
      'Preserve the existing searchTickets application handler; no new external request is made.',
      'Render a registered Vessel in an observable Chart with visible nonzero geometry.',
      'Do not edit protected baseline test/support files.',
    ],
    files: [
      {
        source: 'package.json.fixture',
        path: 'package.json (staged from package.json.fixture)',
      },
      { source: 'src/App.tsx', path: 'src/App.tsx' },
      { source: 'src/SearchPanel.tsx', path: 'src/SearchPanel.tsx' },
      { source: 'src/search.ts', path: 'src/search.ts' },
      {
        source: 'src/SearchPanel.test.tsx',
        path: 'src/SearchPanel.test.tsx (protected baseline; do not edit)',
      },
      {
        source: '.trial/sdk-probe.tsx',
        path: '.trial/sdk-probe.tsx (protected harness)',
      },
      {
        source: 'src/testConnector.ts',
        path: 'src/testConnector.ts (simulated connector)',
      },
    ],
  },
  'debugging-read-only': {
    promptId: 'maelstrom-debugging',
    fixture: 'debugging-react',
    mode: 'read-only',
    goal: 'Diagnose the supplied synthetic report using only its recorded evidence.',
    task: 'Diagnose report.md without editing. Treat req-browser-17 and req-server-42 as distinct attempts unless evidence links them. Separate direct observations from hypotheses, state what is unsupported, and recommend one bounded next diagnostic.',
    rubric: [
      'Keep req-browser-17 and req-server-42 separate; no evidence joins them.',
      'Browser evidence is refusal with no HTTP status/response; server evidence is accepted/processing followed by provider timeout/504.',
      'Do not claim the timeout caused the refusal or assert a shared root cause.',
      'Name missing correlation-preserving evidence and one bounded next diagnostic.',
    ],
    files: [{ source: 'report.md', path: 'report.md' }],
  },
};

/** Builds canonical prompt + separate task and hashes the exact fixture excerpts. */
export async function buildCaseInput(caseId: CaseId): Promise<{
  input: string;
  prompt: { id: string; version: string; sha256: string };
  task: { text: string; sha256: string };
  fixtureFiles: {
    path: string;
    source: string;
    sha256: string;
    text: string;
  }[];
}> {
  const definition = caseRegistry[caseId];
  const prompt = parsePromptSource(
    await readFile(
      join(docsRoot, `prompts/library/${definition.promptId}.md`),
      'utf8',
    ),
    `${definition.promptId}.md`,
  );
  const replacements: Record<string, string> = {
    '[PRODUCT GOAL]': definition.goal,
    '[PATH]': 'the supplied isolated fixture',
    '[USER GOAL]': definition.goal,
    '[COMPONENT PATH]':
      caseId === 'modeling-read-only' ? 'src/Queue.tsx' : 'src/SearchPanel.tsx',
    '[GOAL AND LIMITS]': definition.task,
    '[APPROVED INVENTORY / PLAN]': definition.task,
    '[DESCRIPTION]': 'synthetic connection failure described in report.md',
    '[OUTPUT]': 'See report.md',
    '[PATHS OR "discover"]': 'report.md',
    '[DIAGNOSE ONLY | IMPLEMENT A FIX]': 'DIAGNOSE ONLY',
  };
  let promptBody = prompt.body;
  for (const [placeholder, value] of Object.entries(replacements))
    promptBody = promptBody.replaceAll(placeholder, value);
  const files = await Promise.all(
    definition.files.map(
      async ({ source, path, fixture = definition.fixture }) => {
        const text = await readFile(join(fixtureRoot, fixture, source), 'utf8');
        return {
          path,
          source: `${fixture}/${source}`,
          sha256: sha256(text),
          text,
        };
      },
    ),
  );
  const executionPolicy =
    definition.mode === 'implementation'
      ? '\n\nTemporary trial execution policy: tools run on the trusted host with no OS sandbox. Work only in this disposable case project. Do not inspect or modify any path outside the candidate project; do not inspect environment variables or credentials, access user/global Pi configuration, use network services, contact unrelated servers, restart/kill processes you do not own, or delegate to another agent. Run only the local case typecheck/tests requested by the task. This instruction is not a technical confinement boundary.'
      : '';
  const task = `${definition.task}${executionPolicy}\n\nEvidence output contract (exact JSON schema; no extra keys):\n{"claims":[{"proposition":"A concise factual claim.","evidence":[{"file":"<exact supplied Fixture file path>","quote":"an exact substring copied from the supplied fixture"}]}]}\n- The root has exactly the key claims, a nonempty array. Each claim has exactly proposition (nonempty string) and evidence (nonempty array). Each evidence object has exactly file (string equal to one supplied Fixture file path) and quote (string, 4–300 Unicode code points inclusive). The placeholder in the example is replaced by a literal supplied path.\n- A quote must be an exact, case-sensitive, contiguous substring of the named fixture file. Use the literal path printed after Fixture file:; do not substitute path, file_path, line-number suffixes, or repository paths.\n- This schema checks source links only; an exact quote does not establish semantic correctness.\n\nSemantic review rubric (independent reviewer required; never self-grade):\n${definition.rubric.map((item) => `- ${item}`).join('\n')}`;
  const excerpt = files
    .map((file) => `\nFixture file: ${file.path}\n---\n${file.text}\n---`)
    .join('\n');
  return {
    input: `${promptBody}\n\nEvaluation task:\n${task}${excerpt}`,
    prompt: {
      id: prompt.metadata.id,
      version: prompt.metadata.prompt_version,
      sha256: sha256(prompt.body),
    },
    task: { text: task, sha256: sha256(task) },
    fixtureFiles: files,
  };
}

/** Validates the published evidence JSON contract and exact source excerpts without judging claim meaning. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
  location: string,
  errors: string[],
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  )
    return;
  errors.push(
    `${location} keys must be exactly ${wanted.join(', ')}; found ${actual.join(', ') || '(none)'}`,
  );
}

function evidenceCriterion(
  id: string,
  errors: string[],
): { id: string; status: 'failed' | 'passed'; evidence: string } {
  return {
    id,
    status: errors.length ? 'failed' : 'passed',
    evidence: errors.length
      ? errors.join('; ')
      : 'All evidence items passed this validation dimension.',
  };
}

export function gradeCaseEvidence(
  caseId: CaseId,
  output: string,
  fixtureTexts: Record<string, string>,
): { id: string; status: 'passed' | 'failed' | 'unrun'; evidence: string }[] {
  const allowed = new Set(caseRegistry[caseId].files.map((file) => file.path));
  const schemaErrors: string[] = [];
  const pathErrors: string[] = [];
  const lengthErrors: string[] = [];
  const quoteErrors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    schemaErrors.push('response is not valid JSON');
  }
  let claims: unknown[] = [];
  if (isRecord(parsed)) {
    exactKeys(parsed, ['claims'], 'root', schemaErrors);
    if (Array.isArray(parsed.claims)) claims = parsed.claims;
    else schemaErrors.push('root.claims must be an array');
  } else if (parsed !== undefined) {
    schemaErrors.push('root must be an object');
  }
  if (claims.length === 0) schemaErrors.push('root.claims must be nonempty');

  for (const [claimIndex, claim] of claims.entries()) {
    const location = `claims[${claimIndex}]`;
    if (!isRecord(claim)) {
      schemaErrors.push(`${location} must be an object`);
      continue;
    }
    exactKeys(claim, ['proposition', 'evidence'], location, schemaErrors);
    if (typeof claim.proposition !== 'string' || !claim.proposition.trim())
      schemaErrors.push(`${location}.proposition must be a nonempty string`);
    if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) {
      schemaErrors.push(`${location}.evidence must be a nonempty array`);
      continue;
    }
    for (const [evidenceIndex, evidence] of claim.evidence.entries()) {
      const evidenceLocation = `${location}.evidence[${evidenceIndex}]`;
      if (!isRecord(evidence)) {
        schemaErrors.push(`${evidenceLocation} must be an object`);
        continue;
      }
      exactKeys(evidence, ['file', 'quote'], evidenceLocation, schemaErrors);
      if (typeof evidence.file !== 'string' || !allowed.has(evidence.file)) {
        pathErrors.push(
          `${evidenceLocation}.file is not a supplied fixture path`,
        );
        continue;
      }
      if (typeof evidence.quote !== 'string') {
        schemaErrors.push(`${evidenceLocation}.quote must be a string`);
        continue;
      }
      const quoteLength = Array.from(evidence.quote).length;
      if (quoteLength < 4 || quoteLength > 300) {
        lengthErrors.push(
          `${evidenceLocation}.quote has ${quoteLength} code points; allowed range is 4–300`,
        );
        continue;
      }
      if (!fixtureTexts[evidence.file]?.includes(evidence.quote))
        quoteErrors.push(
          `${evidenceLocation}.quote is not an exact substring of ${evidence.file}`,
        );
    }
  }
  const validations = [
    evidenceCriterion('evidence-json-schema', schemaErrors),
    evidenceCriterion('evidence-fixture-path', pathErrors),
    evidenceCriterion('evidence-quote-length', lengthErrors),
    evidenceCriterion('evidence-quote-membership', quoteErrors),
  ];
  const failedValidations = validations.filter(
    ({ status }) => status === 'failed',
  );
  return [
    {
      id: 'structured-evidence-links',
      status: failedValidations.length ? 'failed' : 'passed',
      evidence: failedValidations.length
        ? failedValidations
            .map(({ id, evidence }) => `${id}: ${evidence}`)
            .join('; ')
        : `${claims.length} claim(s) satisfy the evidence contract; semantic correctness remains ungraded.`,
    },
    ...validations,
    {
      id: 'semantic-review',
      status: 'unrun',
      evidence: `Independent reviewer rubric: ${caseRegistry[caseId].rubric.join(' ')}`,
    },
  ];
}

export function caseId(value: string): value is CaseId {
  return Object.hasOwn(caseRegistry, value);
}
export function definitionFor(caseId: CaseId): Readonly<CaseDefinition> {
  return caseRegistry[caseId];
}
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
