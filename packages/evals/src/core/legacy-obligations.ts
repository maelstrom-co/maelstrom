import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { EvalCase } from './case-schema.js';
import { readScenarioSnapshot } from './scenario-snapshot.js';

const pointer = z
  .string()
  .regex(/^\/items\/(0|[1-9]\d*)$/)
  .refine((value) => Number(value.slice(7)) < 41);
const id = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const text = z.string().min(1).max(2000);
const sourcePath = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/)
  .max(300);
const sourceRow = z.strictObject({
  id,
  input: z.strictObject({
    prompt: text.optional(),
    target: text,
    messages: z
      .array(
        z.strictObject({
          role: z.literal('user'),
          content: z
            .array(z.strictObject({ type: z.literal('text'), content: text }))
            .min(1)
            .max(5),
        }),
      )
      .min(1)
      .max(3)
      .optional(),
  }),
  expectedOutput: z.strictObject({
    rule: text,
    expected_instances: z
      .array(z.strictObject({ instance_id: text, expected_variant: text }))
      .max(3)
      .optional(),
    labs_preserved: z.boolean().optional(),
  }),
  metadata: z.strictObject({
    category: z.enum(['regression', 'capability']),
    difficulty: text.optional(),
    pattern: text.optional(),
  }),
});

/** Canonical source-row digest preserves values while ignoring object-key order. */
export function legacySourceDigest(value: unknown): string {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(
              Object.keys(item)
                .sort()
                .map((key) => [key, item[key]]),
            )
          : item,
      ),
    )
    .digest('hex');
}

/** Source obligations, scope exclusions and bounded unit evidence are not executable eval cases. */
export const legacyObligationsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    source: z.strictObject({
      revision: z.literal('d6ef99aacb8ebce4d707d54fee14149daeea552d'),
      path: z.literal('langfuse/maelstrom-eval-dataset.v1.json'),
    }),
    rows: z
      .array(
        z.strictObject({
          pointer,
          id,
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .length(41),
    obligations: z
      .array(
        z.discriminatedUnion('status', [
          z.strictObject({
            pointer,
            row: sourceRow,
            status: z.literal('out-of-scope'),
            reason: text.refine((value) => !!value.trim(), 'Reason is blank'),
          }),
          z.strictObject({
            pointer,
            row: sourceRow,
            status: z.literal('blocked'),
            blocker: z.strictObject({
              kind: z.enum([
                'unregistered-task',
                'initial-state-contract-conflict',
                'transition-contract-conflict',
              ]),
              verified: z
                .array(z.strictObject({ path: sourcePath, statement: text }))
                .min(1)
                .max(5),
              unconfirmed: z.array(text).min(1).max(5),
            }),
          }),
          z.strictObject({
            pointer,
            row: sourceRow,
            status: z.literal('current-unit-test-evidence'),
            evidence: z.strictObject({
              testPath: sourcePath.regex(/\.test\.ts$/),
              testName: text,
              scope: text,
              limitations: z.array(text).min(1).max(5),
            }),
          }),
        ]),
      )
      .max(41),
  })
  .superRefine((value, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: 'custom', message });
    for (const [index, row] of value.rows.entries())
      if (row.pointer !== `/items/${index}`)
        issue('Source index must contain all 41 distinct ordered pointers');
    const seen = new Set<string>();
    for (const obligation of value.obligations) {
      if (seen.has(obligation.pointer)) issue('Duplicate source obligation');
      seen.add(obligation.pointer);
      const source = value.rows.find(
        (row) => row.pointer === obligation.pointer,
      );
      if (
        !source ||
        source.id !== obligation.row.id ||
        source.sha256 !== legacySourceDigest(obligation.row)
      )
        issue('Source row differs from the pinned source index');
    }
  });

/** Validated ledger distinguishing blocked rows, scope exclusions and bounded current unit evidence. */
export type LegacyObligations = z.infer<typeof legacyObligationsSchema>;

/** Reads a fixed local ledger; no sibling repository, providers, or executable case dispatch. */
export function loadLegacyObligations(): LegacyObligations {
  return legacyObligationsSchema.parse(
    readScenarioSnapshot(
      new URL('../../obligations/v1/legacy.json', import.meta.url),
    ),
  );
}

/** Exhaustive row accounting, not case completion or model-quality coverage. */
export function buildLegacyAccounting(
  cases: readonly { readonly definition: Pick<EvalCase, 'id' | 'lineage'> }[],
  input: LegacyObligations,
) {
  const ledger = legacyObligationsSchema.parse(input);
  const evidence = new Map<string, string[]>();
  const caseIds = new Set<string>();
  for (const { definition } of cases) {
    if (caseIds.has(definition.id))
      throw new Error('Duplicate case ID in legacy accounting');
    caseIds.add(definition.id);
    const pointers = new Set<string>();
    for (const source of definition.lineage) {
      if (source.source !== 'legacy') continue;
      const row = ledger.rows.find((row) => row.pointer === source.pointer);
      if (
        source.revision !== ledger.source.revision ||
        source.path !== ledger.source.path ||
        !row ||
        row.id !== source.taskId ||
        row.id !== source.datasetId
      )
        throw new Error(
          'Case lineage does not match the pinned legacy source index',
        );
      if (pointers.has(source.pointer))
        throw new Error('Duplicate row lineage within a case');
      pointers.add(source.pointer);
      evidence.set(source.pointer, [
        ...(evidence.get(source.pointer) ?? []),
        definition.id,
      ]);
    }
  }
  const blockedObligations = ledger.obligations.filter(
    (obligation) => obligation.status === 'blocked',
  );
  const unitObligations = ledger.obligations.filter(
    (obligation) => obligation.status === 'current-unit-test-evidence',
  );
  const outOfScopeObligations = ledger.obligations.filter(
    (obligation) => obligation.status === 'out-of-scope',
  );
  const blocked = new Set(blockedObligations.map(({ pointer }) => pointer));
  const units = new Set(unitObligations.map(({ pointer }) => pointer));
  const outOfScope = new Set(
    outOfScopeObligations.map(({ pointer }) => pointer),
  );
  for (const row of ledger.rows) {
    if (
      evidence.has(row.pointer) &&
      (blocked.has(row.pointer) ||
        units.has(row.pointer) ||
        outOfScope.has(row.pointer))
    )
      throw new Error(
        'Legacy row has overlapping case and ledger classifications',
      );
    if (
      !evidence.has(row.pointer) &&
      !blocked.has(row.pointer) &&
      !units.has(row.pointer) &&
      !outOfScope.has(row.pointer)
    )
      throw new Error(`Unaccounted legacy row: ${row.pointer}`);
  }
  return {
    interpretation:
      'Case-lineage and code-unit rows have distinct bounded evidence, not complete behavioral coverage. Code-unit evidence, source-only blocked obligations and out-of-scope obligations never enter case execution, scoring or pass counts. Scope exclusions are accounting only, not evidence or model-quality results. Shared task IDs do not merge distinct dataset pointers.',
    source: ledger.source,
    counts: {
      sourceRows: ledger.rows.length,
      rowsWithBoundedCaseEvidence: evidence.size,
      rowsWithBoundedCodeUnitEvidence: units.size,
      sourceOnlyBlockedObligations: blocked.size,
      outOfScopeObligations: outOfScope.size,
      accountedRows:
        evidence.size + units.size + blocked.size + outOfScope.size,
      unaccountedRows: 0,
    },
    rowsWithBoundedCaseEvidence: ledger.rows
      .filter(({ pointer }) => evidence.has(pointer))
      .map(({ pointer, id }) => ({
        pointer,
        datasetId: id,
        caseIds: [...(evidence.get(pointer) ?? [])].sort(),
      })),
    rowsWithBoundedCodeUnitEvidence: unitObligations
      .map(({ pointer, row, evidence }) => ({
        pointer,
        datasetId: row.id,
        evidence,
      }))
      .sort((a, b) => Number(a.pointer.slice(7)) - Number(b.pointer.slice(7))),
    sourceOnlyBlockedObligations: blockedObligations
      .map(({ pointer, row, blocker }) => ({
        pointer,
        datasetId: row.id,
        blocker,
      }))
      .sort((a, b) => Number(a.pointer.slice(7)) - Number(b.pointer.slice(7))),
    outOfScopeObligations: outOfScopeObligations
      .map(({ pointer, row, reason }) => ({
        pointer,
        datasetId: row.id,
        reason,
      }))
      .sort((a, b) => Number(a.pointer.slice(7)) - Number(b.pointer.slice(7))),
  };
}
