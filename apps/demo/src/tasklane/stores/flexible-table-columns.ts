import type { FlexibleTableFailure } from './flexible-table-failures';
import { parseFormula } from './flexible-table-formula';
import type { ProjectTask } from './project-tasks.store';

export const TABLE_COLUMN_KINDS = ['field', 'computed', 'free'] as const;
type TableColumnKind = (typeof TABLE_COLUMN_KINDS)[number];

export interface TableColumn {
  readonly id: string;
  readonly label: string;
  readonly kind: TableColumnKind;
  readonly field?: string;
  readonly formula?: string;
}

export const RESERVED_COLUMN_IDS = ['none', 'clear', 'ungroup'];

type ColumnLookup =
  | { readonly kind: 'found'; readonly column: TableColumn }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly TableColumn[];
    }
  | { readonly kind: 'not_found' };

const KNOWN_TASK_FIELDS = new Set<string>([
  'id',
  'title',
  'description',
  'parentId',
  'assigneeId',
  'urgency',
  'status',
  'createdAt',
  'dueDate',
  'sourceFeedback',
  'estimate',
  'spent',
  'triageReason',
]);

const FIELD_ALIASES: Readonly<Record<string, string>> = {
  id: 'id',
  title: 'title',
  description: 'description',
  parent: 'parentId',
  parentid: 'parentId',
  parent_id: 'parentId',
  assignee: 'assigneeId',
  owner: 'assigneeId',
  assigneeid: 'assigneeId',
  assignee_id: 'assigneeId',
  urgency: 'urgency',
  status: 'status',
  created: 'createdAt',
  createdat: 'createdAt',
  created_at: 'createdAt',
  due: 'dueDate',
  duedate: 'dueDate',
  due_date: 'dueDate',
  source: 'sourceFeedback',
  feedback: 'sourceFeedback',
  sourcefeedback: 'sourceFeedback',
  source_feedback: 'sourceFeedback',
  estimate: 'estimate',
  spent: 'spent',
  reason: 'triageReason',
  triagereason: 'triageReason',
  triage_reason: 'triageReason',
};

export function findColumn(
  columnRef: string,
  columns: readonly TableColumn[],
): { readonly ok: true; readonly column: TableColumn } | FlexibleTableFailure {
  const lookup = lookupColumn(columnRef, columns);
  if (lookup.kind === 'found') return { ok: true, column: lookup.column };
  if (lookup.kind === 'ambiguous') {
    return ambiguousColumnFailure(columnRef, lookup.candidates);
  }
  return { ok: false, reason: 'unknown_column', query: columnRef };
}

export function ambiguousColumnFailure(
  query: string,
  candidates: readonly TableColumn[],
): FlexibleTableFailure {
  return {
    ok: false,
    reason: 'ambiguous_column',
    query,
    candidates: candidates.map((col) => `${col.id} (${col.label})`),
  };
}

export function lookupColumn(
  query: string,
  columns: readonly TableColumn[],
): ColumnLookup {
  const exact = query.trim();
  if (!exact) return { kind: 'not_found' };
  const lower = exact.toLowerCase();
  const slug = slugKey(lower);
  const aliasedField = lookupFieldAlias(lower) ?? lookupFieldAlias(slug);

  const tiers: readonly ((col: TableColumn) => boolean)[] = [
    (col) => col.id === exact,
    (col) => col.label.trim().toLowerCase() === lower,
    (col) => slug !== '' && slugKey(col.label) === slug,
    (col) => col.id.toLowerCase() === lower,
    (col) =>
      col.kind === 'field' &&
      col.field !== undefined &&
      (col.field.toLowerCase() === lower ||
        (aliasedField !== undefined && col.field === aliasedField)),
  ];
  for (const matches of tiers) {
    const hits = columns.filter(matches);
    if (hits.length === 1) return { kind: 'found', column: hits[0] };
    if (hits.length > 1) return { kind: 'ambiguous', candidates: hits };
  }
  return { kind: 'not_found' };
}

export function columnsReferencing(
  target: TableColumn,
  columns: readonly TableColumn[],
  tasks: readonly ProjectTask[],
): readonly string[] {
  const dependents: string[] = [];
  for (const col of columns) {
    if (col.kind !== 'computed' || col.id === target.id) continue;
    const parsed = parseFormula(col.formula ?? '');
    if (!parsed.ok) continue;
    const others = columns.filter((other) => other.id !== col.id);
    const remaining = others.filter((other) => other.id !== target.id);
    const blocks = parsed.references.some((ref) => {
      const lookup = lookupColumn(ref, others);
      if (lookup.kind !== 'found' || lookup.column.id !== target.id) {
        return false;
      }
      const readsSameTaskField =
        target.kind === 'field' &&
        lookupColumn(ref, remaining).kind === 'not_found' &&
        resolveTaskField(ref, tasks) === (target.field ?? target.id);
      return !readsSameTaskField;
    });
    if (blocks) dependents.push(col.label);
  }
  return dependents;
}

export function findFormulaCycle(
  columns: readonly TableColumn[],
): readonly string[] | undefined {
  const edges = new Map<string, readonly TableColumn[]>();
  for (const col of columns) {
    if (col.kind !== 'computed') continue;
    const parsed = parseFormula(col.formula ?? '');
    if (!parsed.ok) continue;
    const others = columns.filter((other) => other.id !== col.id);
    edges.set(
      col.id,
      parsed.references.flatMap((ref) => {
        const lookup = lookupColumn(ref, others);
        return lookup.kind === 'found' && lookup.column.kind === 'computed'
          ? [lookup.column]
          : [];
      }),
    );
  }

  const settled = new Set<string>();
  const path: TableColumn[] = [];
  const visit = (col: TableColumn): readonly string[] | undefined => {
    const start = path.findIndex((onPath) => onPath.id === col.id);
    if (start !== -1) {
      return [...path.slice(start), col].map((onPath) => onPath.label);
    }
    if (settled.has(col.id)) return undefined;
    path.push(col);
    for (const next of edges.get(col.id) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    settled.add(col.id);
    return undefined;
  };
  for (const col of columns) {
    const cycle = visit(col);
    if (cycle) return cycle;
  }
  return undefined;
}

export function resolveTaskField(
  query: string,
  tasks: readonly ProjectTask[],
): string | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  const slug = slugKey(trimmed);

  const alias = lookupFieldAlias(lower) ?? lookupFieldAlias(slug);
  if (alias) return alias;

  for (const field of KNOWN_TASK_FIELDS) {
    if (field.toLowerCase() === lower) return field;
  }

  for (const task of tasks) {
    for (const key of Object.keys(task)) {
      if (key.toLowerCase() === lower || (slug !== '' && slugKey(key) === slug))
        return key;
    }
  }

  return undefined;
}

export function resolveColumnKind(query: string): TableColumnKind | undefined {
  const lower = query.trim().toLowerCase();
  return TABLE_COLUMN_KINDS.find((kind) => kind === lower);
}

export function slugify(value: string): string {
  return slugKey(value) || 'col';
}

export function uniqueColumnId(
  base: string,
  columns: readonly TableColumn[],
): string {
  const taken = new Set([
    ...RESERVED_COLUMN_IDS,
    ...columns.map((col) => col.id.toLowerCase()),
  ]);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

function lookupFieldAlias(key: string): string | undefined {
  return Object.hasOwn(FIELD_ALIASES, key) ? FIELD_ALIASES[key] : undefined;
}

// Empty for a name with no ASCII letters or digits, so such names never
// match each other through the slug.
function slugKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
