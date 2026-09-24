import type { z } from 'zod';

/**
 * Renders every issue of a Zod validation error as one line, for the
 * message of an error thrown when caller-supplied options fail validation.
 *
 * Issues are joined with `; `. Each reads `path [code]: message`, with
 * `(root)` standing in for an empty path. A union issue appends its failed
 * branches in parentheses, separated by ` | `; nested issues within a
 * branch or a container issue are joined with ` & `.
 *
 * @param error - The error from a failed `safeParse` or `parse`.
 * @returns The formatted issues, never empty for a non-empty issue list.
 */
export function formatValidationIssues(error: z.ZodError): string {
  return error.issues.map(formatIssue).join('; ');
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
  const base = `${path} [${issue.code}]: ${issue.message}`;
  if (hasNestedBranches(issue)) {
    const branches = issue.errors
      .map((branch) => branch.map(formatIssue).join(' & '))
      .join(' | ');
    return branches.length > 0 ? `${base} (${branches})` : base;
  }
  if (hasNestedIssues(issue)) {
    const nested = issue.issues.map(formatIssue).join(' & ');
    return nested.length > 0 ? `${base} (${nested})` : base;
  }
  return base;
}

function hasNestedBranches(
  issue: z.core.$ZodIssue,
): issue is z.core.$ZodIssue & {
  readonly errors: readonly z.core.$ZodIssue[][];
} {
  return (
    'errors' in issue && Array.isArray((issue as { errors?: unknown }).errors)
  );
}

function hasNestedIssues(issue: z.core.$ZodIssue): issue is z.core.$ZodIssue & {
  readonly issues: readonly z.core.$ZodIssue[];
} {
  return (
    'issues' in issue && Array.isArray((issue as { issues?: unknown }).issues)
  );
}
