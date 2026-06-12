// ---------------------------------------------------------------------------
// Prompt section types and constants — single source of truth for both
// system prompt sections and user prompt sections.
// ---------------------------------------------------------------------------

export interface PromptSection {
  readonly key: string;
  readonly content: string;
}

/**
 * Customize a prompt section. Four forms:
 *
 * - `string` — replace the section content entirely
 * - `{ prepend?, append? }` — extend without knowing the default content
 * - `(defaultContent) => string` — full transform (power user)
 * - `null` — remove the section
 *
 * For new (non-default) section keys, only `string` and `{ prepend?, append? }`
 * are allowed. Function customizers require an existing section to transform.
 */
export type SectionCustomizer =
  | string
  | SectionExtension
  | ((defaultContent: string) => string)
  | null;

export type SectionExtension =
  | { readonly prepend: string; readonly append?: string }
  | { readonly prepend?: string; readonly append: string };

// ---------------------------------------------------------------------------
// System prompt section keys
// ---------------------------------------------------------------------------

export const SystemSection = {
  IDENTITY: 'identity',
  TRIGGERS: 'triggers',
  LAYOUT: 'layout',
  ACTIONS: 'actions',
  RULES: 'rules',
} as const;

export type SystemSectionKey =
  (typeof SystemSection)[keyof typeof SystemSection];

// ---------------------------------------------------------------------------
// User prompt section keys
// ---------------------------------------------------------------------------

export const UserSection = {
  VESSELS: 'vessels',
  CHART_STATE: 'chartState',
  UPDATE_TRIGGERS: 'updateTriggers',
} as const;

export type UserSectionKey = (typeof UserSection)[keyof typeof UserSection];

// ---------------------------------------------------------------------------
// Typed section override records — known keys get autocomplete,
// arbitrary keys allowed for new sections.
// ---------------------------------------------------------------------------

export type SystemSectionOverrides = {
  [K in SystemSectionKey]?: SectionCustomizer;
} & { [key: string]: SectionCustomizer | undefined };

export type UserSectionOverrides = {
  [K in UserSectionKey]?: SectionCustomizer;
} & { [key: string]: SectionCustomizer | undefined };

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isSectionExtension(
  value: SectionCustomizer,
): value is SectionExtension {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('prepend' in value || 'append' in value)
  );
}
