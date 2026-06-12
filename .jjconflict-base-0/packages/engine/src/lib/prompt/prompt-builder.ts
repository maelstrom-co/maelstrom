import type { ChartRequest, LayoutMode } from '@maelstrom-co/protocol';

import type {
  PromptSection,
  SectionCustomizer,
  SystemSectionOverrides,
  UserSectionOverrides,
} from './sections.js';
import { isSectionExtension } from './sections.js';
import { getDefaultSystemSections } from './system-prompts.js';
import { buildDefaultUserSections } from './request-serializer.js';
import type { Logger } from '../logger.js';

const DEFAULT_VARS: PromptVars = {
  assistantName: 'Maelstrom',
};

export interface PromptVars {
  /** Assistant name substituted into the identity section. Default: 'Maelstrom' */
  readonly assistantName?: string;
  /** Arbitrary extra variables for custom sections */
  readonly [key: string]: string | undefined;
}

export interface PromptOptions {
  /** Template variables substituted into section defaults (e.g. assistantName) */
  readonly vars?: PromptVars;
  /** System prompt section customizations. See SystemSection for available keys. */
  readonly system?: Readonly<SystemSectionOverrides>;
  /** User prompt section customizations. See UserSection for available keys. */
  readonly user?: Readonly<UserSectionOverrides>;
}

export interface PromptResult {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly sections: {
    readonly system: readonly PromptSection[];
    readonly user: readonly PromptSection[];
  };
}

/**
 * Build the full prompt (system + user halves) for a chart request.
 *
 * Thin composition over {@link buildSystemPrompt} and {@link buildUserPrompt}.
 * The returned `sections` array exposes the post-override section list, useful
 * for telemetry or diffing customizer effects.
 *
 * @throws {Error} If a section customizer is invalid (function targeting a
 *   non-default key) or itself throws. Messages have the form
 *   `Prompt section customizer for "<key>" ...` so consumers can extract the
 *   failing section key from the quoted prefix.
 *
 * @example
 * ```ts
 * const { systemPrompt, userPrompt } = buildPrompt(request, {
 *   vars: { assistantName: 'Aria' },
 *   system: { rules: (defaults) => `${defaults}\n\nAlways respond in Spanish.` },
 *   user: { vessels: 'Custom vessel definitions here.' },
 * });
 * ```
 */
export function buildPrompt(
  request: ChartRequest,
  options?: PromptOptions,
  logger?: Logger,
): PromptResult {
  const systemSections = buildSystemSections(
    request.context.layoutMode,
    options,
  );
  const userSections = buildUserSections(request, options, logger);

  return {
    systemPrompt: joinSections(systemSections),
    userPrompt: joinSections(userSections),
    sections: { system: systemSections, user: userSections },
  };
}

/**
 * Build the system-prompt half for a given layout mode and config-time options.
 *
 * Pure: depends only on its arguments, so the result can be cached per
 * `(mode, options)` tuple. {@link createEngine} precomputes one string per
 * `LayoutMode` at factory time and indexes by `request.context.layoutMode` per
 * request — derive once, not per-turn.
 *
 * @throws {Error} If a `system` customizer is invalid (function targeting a
 *   non-default key) or itself throws. Messages have the form
 *   `Prompt section customizer for "<key>" ...`.
 *
 * @example
 * ```ts
 * const systemPrompt = buildSystemPrompt('grid', {
 *   vars: { assistantName: 'Aria' },
 *   system: { identity: 'You are a healthcare assistant.' },
 * });
 * ```
 */
export function buildSystemPrompt(
  mode: LayoutMode,
  options?: Pick<PromptOptions, 'vars' | 'system'>,
): string {
  return joinSections(buildSystemSections(mode, options));
}

/**
 * Build the user-prompt half from a chart request.
 *
 * Per-call work — depends on the request's vessels, instances, layout, and
 * update reasons, so the result can't be precomputed.
 *
 * @throws {Error} If a `user` customizer is invalid (function targeting a
 *   non-default key) or itself throws. Messages have the form
 *   `Prompt section customizer for "<key>" ...`. Callers operating inside a
 *   `Promise<Result>` contract should wrap in try/catch and convert to a
 *   Result error rather than letting the throw escape.
 *
 * @example
 * ```ts
 * const userPrompt = buildUserPrompt(request, {
 *   user: { vessels: (defaults) => `${defaults}\n\nDomain note: …` },
 * });
 * ```
 */
export function buildUserPrompt(
  request: ChartRequest,
  options?: Pick<PromptOptions, 'user'>,
  logger?: Logger,
): string {
  return joinSections(buildUserSections(request, options, logger));
}

function buildSystemSections(
  mode: LayoutMode,
  options?: Pick<PromptOptions, 'vars' | 'system'>,
): readonly PromptSection[] {
  const vars = resolveVars(options?.vars);
  const defaults = recordToSections(getDefaultSystemSections(mode));
  const interpolated = interpolateVars(defaults, vars);
  return applySectionOverrides(interpolated, options?.system);
}

function buildUserSections(
  request: ChartRequest,
  options?: Pick<PromptOptions, 'user'>,
  logger?: Logger,
): readonly PromptSection[] {
  const defaults = buildDefaultUserSections(request, logger);
  return applySectionOverrides(defaults, options?.user);
}

function resolveVars(vars?: PromptVars): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...DEFAULT_VARS, ...vars })) {
    if (value !== undefined) {
      resolved[key] = value;
    }
  }
  return resolved;
}

function interpolateVars(
  sections: readonly PromptSection[],
  vars: Record<string, string>,
): readonly PromptSection[] {
  return sections.map((section) => ({
    key: section.key,
    content: replaceVars(section.content, vars),
  }));
}

function replaceVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in vars ? (vars[key] ?? match) : match,
  );
}

function recordToSections(
  record: Record<string, string>,
): readonly PromptSection[] {
  return Object.entries(record).map(([key, content]) => ({ key, content }));
}

function applySectionOverrides(
  defaults: readonly PromptSection[],
  overrides?: Readonly<Record<string, SectionCustomizer | undefined>>,
): readonly PromptSection[] {
  if (!overrides) return defaults;

  const result: PromptSection[] = [];
  const defaultKeys = new Set(defaults.map((s) => s.key));

  for (const section of defaults) {
    const customizer = overrides[section.key];

    if (customizer === undefined) {
      result.push(section);
    } else if (customizer === null) {
      // Section removed
    } else if (typeof customizer === 'string') {
      result.push({ key: section.key, content: customizer });
    } else if (isSectionExtension(customizer)) {
      const parts = [
        customizer.prepend,
        section.content,
        customizer.append,
      ].filter(Boolean);
      result.push({ key: section.key, content: parts.join('\n\n') });
    } else {
      try {
        result.push({
          key: section.key,
          content: customizer(section.content),
        });
      } catch (error) {
        throw new Error(
          `Prompt section customizer for "${section.key}" threw: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
  }

  // Append new sections from overrides that don't match any default key.
  for (const [key, customizer] of Object.entries(overrides)) {
    if (defaultKeys.has(key) || customizer == null) continue;

    if (typeof customizer === 'function') {
      throw new Error(
        `Prompt section customizer for "${key}" is a function, but "${key}" is not a default section. ` +
          'Use a string value or { prepend, append } to add new sections.',
      );
    }

    if (typeof customizer === 'string') {
      result.push({ key, content: customizer });
    } else if (isSectionExtension(customizer)) {
      const parts = [customizer.prepend, customizer.append].filter(Boolean);
      result.push({ key, content: parts.join('\n\n') });
    }
  }

  return result;
}

function joinSections(sections: readonly PromptSection[]): string {
  return sections
    .filter((s) => s.content.length > 0)
    .map((s) => s.content)
    .join('\n\n');
}
