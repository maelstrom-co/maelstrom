// ---------------------------------------------------------------------------
// Prompt section types and constants — single source of truth for both
// system prompt sections and user prompt sections.
// ---------------------------------------------------------------------------

/** Named prompt fragment retained through customization and composition. */
export interface PromptSection {
  /** Stable section key used to target overrides. */
  readonly key: string;
  /** Text contributed by this section before prompts are joined. */
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

/**
 * Prepend and/or append content. For an existing default section, the content
 * wraps its default text; for a new custom key, `prepend` and `append` are
 * joined directly.
 */
export type SectionExtension =
  | { readonly prepend: string; readonly append?: string }
  | { readonly prepend?: string; readonly append: string };

// ---------------------------------------------------------------------------
// System prompt section keys
// ---------------------------------------------------------------------------

/** Built-in system prompt section keys, in their default semantic order. */
export const SystemSection = {
  IDENTITY: 'identity',
  TRIGGERS: 'triggers',
  LAYOUT: 'layout',
  ACTIONS: 'actions',
  RULES: 'rules',
} as const;

/** Key of a built-in system prompt section. */
export type SystemSectionKey =
  (typeof SystemSection)[keyof typeof SystemSection];

// ---------------------------------------------------------------------------
// User prompt section keys
// ---------------------------------------------------------------------------

/** Built-in user prompt section keys, in their default semantic order. */
export const UserSection = {
  VESSELS: 'vessels',
  CHART_STATE: 'chartState',
  UPDATE_TRIGGERS: 'updateTriggers',
} as const;

/** Key of a built-in user prompt section. */
export type UserSectionKey = (typeof UserSection)[keyof typeof UserSection];

// ---------------------------------------------------------------------------
// Typed section override records — known keys get autocomplete,
// arbitrary keys allowed for new sections.
// ---------------------------------------------------------------------------

/** System-section customizers with built-in-key autocomplete that also allow custom keys. */
export type SystemSectionOverrides = {
  [K in SystemSectionKey]?: SectionCustomizer;
} & { [key: string]: SectionCustomizer | undefined };

/** User-section customizers with built-in-key autocomplete that also allow custom keys. */
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
