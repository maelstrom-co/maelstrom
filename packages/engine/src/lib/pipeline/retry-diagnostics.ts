import { assertNever } from '../assert-never.js';
import type { SkippedAction } from '../response/execution-plan/index.js';
import type {
  DroppedLayoutEntry,
  InstanceDroppedLayoutEntry,
  LayoutWarning,
} from '../validation/llm-output/healed-layout.js';
import { isTreeDrop } from '../validation/llm-output/healed-layout.js';

const MAX_IDENTIFIER_CODE_POINTS = 128;
const MAX_LIST_IDENTIFIERS = 16;
const MAX_DIAGNOSTIC_LINES = 32;
const MAX_DIAGNOSTIC_UTF8_BYTES = 8_192;
const IDENTIFIER_TRUNCATION_SUFFIX = '…[truncated]';
const BYTE_OMISSION_LINE =
  'Additional diagnostic text omitted to fit the byte limit.';
const textEncoder = new TextEncoder();

interface DiagnosticSection {
  /** Trusted heading selected by the renderer, never model-authored text. */
  readonly heading: 'Layout drops:' | 'Layout repairs:' | 'Skipped actions:';
  /** Already identifier-safe diagnostic entries before global bounds. */
  readonly lines: readonly string[];
}

interface DiagnosticLine {
  /** Section ownership retained while global line and byte limits are applied. */
  readonly heading: DiagnosticSection['heading'];
  /** One trusted-template diagnostic with bounded, quoted identifiers. */
  readonly text: string;
}

/**
 * Renders retry diagnostics under identifier, list, line, and UTF-8 ceilings.
 * Model-derived identifiers are control-sanitized, truncated by Unicode code
 * point, and JSON-quoted before interpolation. Resource-limit and definition
 * skips are omitted because retry policy classifies them as non-retryable; they
 * remain omitted when another skip triggers a mixed retry. The caller's
 * original prompt is deliberately outside this renderer.
 *
 * Repairs are rendered alongside drops because a repair is still a rewrite of
 * what the model asked for: a weight suffix the pipeline could not read was
 * substituted, and the model is the only party that can stop emitting it.
 */
export function renderRetryDiagnostics(
  drops: readonly DroppedLayoutEntry[],
  skippedActions: readonly SkippedAction[],
  warnings: readonly LayoutWarning[] = [],
): string {
  const sections = [
    { heading: 'Layout drops:' as const, lines: describeLayoutDrops(drops) },
    {
      heading: 'Layout repairs:' as const,
      lines: describeLayoutWarnings(warnings),
    },
    {
      heading: 'Skipped actions:' as const,
      lines: describeSkippedActions(skippedActions),
    },
  ].filter((section) => section.lines.length > 0);

  return boundDiagnosticSection(sections);
}

/** Sanitizes, code-point-bounds, and JSON-quotes one untrusted identifier. */
function quoteIdentifier(identifier: string): string {
  const sanitized = identifier.replace(/[\p{Cc}\u2028\u2029]/gu, '\uFFFD');
  const codePoints = Array.from(sanitized);
  const bounded =
    codePoints.length <= MAX_IDENTIFIER_CODE_POINTS
      ? sanitized
      : `${codePoints.slice(0, MAX_IDENTIFIER_CODE_POINTS).join('')}${IDENTIFIER_TRUNCATION_SUFFIX}`;
  return JSON.stringify(bounded);
}

/** Renders at most 16 quoted identifiers plus a trusted omission count. */
function formatIdentifierList(identifiers: readonly string[]): string {
  if (identifiers.length === 0) return '(none)';
  const visible = identifiers
    .slice(0, MAX_LIST_IDENTIFIERS)
    .map(quoteIdentifier)
    .join(', ');
  const omitted = identifiers.length - MAX_LIST_IDENTIFIERS;
  if (omitted <= 0) return visible;
  return `${visible}; ${omitted} additional identifier${omitted === 1 ? '' : 's'} omitted`;
}

/**
 * Collapses the shape-error tree drops while preserving bounded per-instance
 * entries. A repeated leaf and an over-wide split each get their own line: the
 * generic advisory tells the model its tree could not be parsed, which is the
 * wrong diagnosis for a tree that parsed perfectly and merely broke a rule.
 */
function describeLayoutDrops(drops: readonly DroppedLayoutEntry[]): string[] {
  const lines: string[] = [];
  const duplicateLeafIds: string[] = [];
  const truncatedSplitLines: string[] = [];
  let hasTreeDrop = false;

  for (const drop of drops) {
    if (drop.reason === 'tree_duplicate_leaf') {
      duplicateLeafIds.push(drop.instanceId);
      continue;
    }
    if (drop.reason === 'tree_split_truncated') {
      truncatedSplitLines.push(
        `A split token declared ${drop.declaredChildCount} children; a single split may declare at most ${drop.keptChildCount}. Nest splits to arrange more regions rather than widening one.`,
      );
      continue;
    }
    if (isTreeDrop(drop)) {
      hasTreeDrop = true;
      continue;
    }
    lines.push(describeInstanceLayoutDrop(drop));
  }

  if (duplicateLeafIds.length > 0) {
    lines.push(
      `The tiling tree named ${formatIdentifierList(duplicateLeafIds)} more than once, and each repeat was blanked out. Every instance ID may appear at most once in the tree — to give an instance more space, weight its split (for example "V:3,1") instead of repeating it.`,
    );
  }
  lines.push(...truncatedSplitLines);
  if (hasTreeDrop) {
    lines.push(
      'The tiling tree was malformed and could not be fully parsed. Re-emit it as a preorder traversal in which every split token is followed by exactly as many subtrees as it declares weights — two for a bare "H" or "V" — using only the requested instance IDs.',
    );
  }
  return lines;
}

/** Renders each layout repair as an instruction the model can act on. */
function describeLayoutWarnings(warnings: readonly LayoutWarning[]): string[] {
  const lines: string[] = [];
  for (const warning of warnings) {
    switch (warning.kind) {
      case 'missing_rationale':
        lines.push(
          'The response omitted its rationale. Include a short rationale explaining the layout decision.',
        );
        break;
      case 'split_weights_repaired':
        lines.push(
          `The split token ${quoteIdentifier(warning.token)} had an unreadable weight suffix and was read as ${warning.weights.length} children weighted ${warning.weights.join(',')}. Weights are comma-separated positive integers, and the weight count is exactly how many subtrees must follow the token.`,
        );
        break;
      default:
        assertNever(warning, 'describeLayoutWarnings');
    }
  }
  return lines;
}

/** Renders one non-tree layout drop without exposing an unquoted identifier. */
function describeInstanceLayoutDrop(entry: InstanceDroppedLayoutEntry): string {
  const instance = quoteIdentifier(entry.instanceId);
  switch (entry.reason) {
    case 'unknown_instance':
      return `instance ${instance} not in request`;
    case 'unknown_vessel':
      return `instance ${instance} referenced unknown vessel ${quoteIdentifier(entry.vesselId)}`;
    case 'unknown_variant':
      return `instance ${instance} referenced unknown variant ${quoteIdentifier(entry.variant)}`;
    case 'position_overflow':
      return `instance ${instance} at (${entry.row},${entry.column}) size ${entry.width}x${entry.height} exceeds chart bounds (${entry.chartColumns}x${entry.chartRows})`;
    case 'size_below_minimum':
      return `instance ${instance} size ${entry.width}x${entry.height} below variant minimum ${entry.minWidth}x${entry.minHeight}`;
    case 'duplicate_instance_id':
      return `instance ${instance} appeared multiple times in layout`;
    default:
      return assertNever(entry, 'describeInstanceLayoutDrop');
  }
}

/** Omits non-actionable skips and renders each remaining skip once. */
function describeSkippedActions(skipped: readonly SkippedAction[]): string[] {
  const lines: string[] = [];
  for (const entry of skipped) {
    const line = describeSkippedAction(entry);
    if (line !== undefined) lines.push(line);
  }
  return lines;
}

/** Returns one safe retry line, or undefined for a non-actionable skip. */
function describeSkippedAction(entry: SkippedAction): string | undefined {
  switch (entry.reason) {
    case 'state_drift':
    case 'params_limits_exceeded':
    case 'invalid_action_definition':
      return undefined;
    case 'self_transition_noop': {
      const action = quoteIdentifier(entry.action);
      const instance = quoteIdentifier(entry.instanceId);
      return `Action ${action} on instance ${instance} is already a no-op — instance ${instance} is already in variant ${quoteIdentifier(entry.currentVariant)}. Omit this specific (instance, action) pair from your next response. Other instances may still legitimately call ${action}.`;
    }
    case 'params_parse_failed':
      return `Action ${quoteIdentifier(entry.action)} on instance ${quoteIdentifier(entry.instanceId)} had unparseable params`;
    case 'params_validation_failed':
      return `Action ${quoteIdentifier(entry.action)} on instance ${quoteIdentifier(entry.instanceId)} had invalid params: ${formatIssueList(entry.issues)}`;
    case 'unknown_instance':
      return `Action ${quoteIdentifier(entry.action)} referenced unknown instance ${quoteIdentifier(entry.instanceId)}`;
    case 'unknown_vessel':
      return `Action ${quoteIdentifier(entry.action)} on instance ${quoteIdentifier(entry.instanceId)} referenced unknown vessel ${quoteIdentifier(entry.vesselId)}`;
    case 'no_simulated_variant':
      return `Action ${quoteIdentifier(entry.action)} on instance ${quoteIdentifier(entry.instanceId)} — no current variant to act on`;
    case 'variant_not_on_vessel':
      return `Action ${quoteIdentifier(entry.action)} on instance ${quoteIdentifier(entry.instanceId)} — variant ${quoteIdentifier(entry.variant)} is not defined on vessel ${quoteIdentifier(entry.vesselId)}`;
    case 'action_not_valid':
      return `Action ${quoteIdentifier(entry.action)} is not valid on instance ${quoteIdentifier(entry.instanceId)} in variant ${quoteIdentifier(entry.variant)} — valid actions: ${formatIdentifierList(entry.validActions)}`;
    default:
      return assertNever(entry, 'describeSkippedAction');
  }
}

/** Renders the closed validation-issue union under the shared list ceiling. */
function formatIssueList(
  issues: Extract<
    SkippedAction,
    { readonly reason: 'params_validation_failed' }
  >['issues'],
): string {
  const visible = issues
    .slice(0, MAX_LIST_IDENTIFIERS)
    .map((issue) => {
      switch (issue.kind) {
        case 'params_not_allowed':
          return 'params are not allowed';
        case 'unknown_parameter':
          return `unknown parameter ${quoteIdentifier(issue.parameter)}`;
        case 'missing_parameter':
          return `missing parameter ${quoteIdentifier(issue.parameter)}`;
        case 'type_mismatch':
          return `parameter ${quoteIdentifier(issue.parameter)} must be ${issue.expected}, not ${issue.actual}`;
        case 'enum_violation':
          return `parameter ${quoteIdentifier(issue.parameter)} is outside its allowed values`;
        default:
          return assertNever(issue, 'formatIssueList');
      }
    })
    .join('; ');
  const omitted = issues.length - MAX_LIST_IDENTIFIERS;
  if (omitted <= 0) return visible;
  return `${visible}; ${omitted} additional issue${omitted === 1 ? '' : 's'} omitted`;
}

/** Caps the section at 32 diagnostic entries and 8,192 rendered UTF-8 bytes. */
function boundDiagnosticSection(
  sections: readonly DiagnosticSection[],
): string {
  const lines = sections.flatMap((section) =>
    section.lines.map((text) => ({ heading: section.heading, text })),
  );
  if (lines.length === 0) return '';

  let bounded = lines;
  if (lines.length > MAX_DIAGNOSTIC_LINES) {
    const retained = lines.slice(0, MAX_DIAGNOSTIC_LINES - 1);
    const omitted = lines.length - retained.length;
    const heading = retained.at(-1)?.heading ?? lines[0]?.heading;
    if (heading === undefined) return '';
    bounded = [
      ...retained,
      { heading, text: `${omitted} diagnostic lines omitted` },
    ];
  }

  const rendered = renderLines(bounded);
  if (textEncoder.encode(rendered).byteLength <= MAX_DIAGNOSTIC_UTF8_BYTES) {
    return rendered;
  }

  const retained = [...bounded];
  while (retained.length > 0) {
    retained.pop();
    const heading = retained.at(-1)?.heading ?? bounded[0]?.heading;
    if (heading === undefined) return '';
    const candidate = renderLines([
      ...retained,
      { heading, text: BYTE_OMISSION_LINE },
    ]);
    if (textEncoder.encode(candidate).byteLength <= MAX_DIAGNOSTIC_UTF8_BYTES) {
      return candidate;
    }
  }
  return '';
}

/** Groups bounded lines under trusted headings without changing line text. */
function renderLines(lines: readonly DiagnosticLine[]): string {
  const output: string[] = [];
  let previousHeading: DiagnosticLine['heading'] | undefined;
  for (const line of lines) {
    if (line.heading !== previousHeading) {
      if (output.length > 0) output.push('');
      output.push(line.heading);
      previousHeading = line.heading;
    }
    output.push(`- ${line.text}`);
  }
  return output.join('\n');
}
