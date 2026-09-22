import {
  llmPlanner,
  type Planner,
  type PlannerCandidate,
  type PlanningInput,
  type Retryable,
  type Stage,
  withRetry,
} from '@maelstrom-co/engine';
import type { AnyTextAdapter } from '@tanstack/ai';

import {
  buildJevPlanner,
  FALLBACK_RETRIES,
  type Instrument,
} from '../src/lib/jev-planner.js';
import { buildJevPocRebuiltPlanner } from '../src/lib/planners/jev-poc-rebuilt.js';
import {
  createJevDeps,
  type JevDeps,
} from '../src/lib/stages-experimental/deps.js';
import type { TypeSafeClientOptions } from '../src/lib/typesafe-client.js';
import type { LlmRole } from './usage-adapter.js';

/** `baseline` is the LLM planner, `jev-poc` the frozen POC, `jev` any later Jev planner. */
export type ArmKind = 'baseline' | 'jev-poc' | 'jev';

/** What the runner hands every arm for one turn. */
export interface ArmDeps {
  /** TypeSafe settings, with the turn's `onCall` recorder. */
  readonly typesafe: TypeSafeClientOptions;
  /** The text adapter for one LLM role, recording that role's calls. */
  readonly adapter: (role: LlmRole) => AnyTextAdapter;
  /** The unwrapped fallback planner, counted by the runner. */
  readonly fallback: Stage<Retryable<PlanningInput>, PlannerCandidate>;
  /** Wraps every Jev stage, for recording and replay. */
  readonly instrument: Instrument;
}

export interface Arm {
  readonly name: string;
  readonly kind: ArmKind;
  readonly build: (deps: ArmDeps) => Planner;
}

/** The demo's system rules (apps/demo/src/server/engine-config.ts), so every arm prompts the LLM like the demo. */
export const SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

/** Every arm the runner knows, by name. */
export const arms: Readonly<Record<string, Arm>> = {
  baseline: {
    name: 'baseline',
    kind: 'baseline',
    build: (deps) =>
      withRetry(demoLlmPlanner(deps.adapter('planner')), {
        max: FALLBACK_RETRIES,
      }),
  },
  'jev-poc': {
    name: 'jev-poc',
    kind: 'jev-poc',
    build: (deps) =>
      buildJevPlanner(
        {
          typesafe: deps.typesafe,
          adapter: deps.adapter('complete'),
          fallback: deps.fallback,
        },
        deps.instrument,
      ),
  },
  'jev-poc-rebuilt': {
    name: 'jev-poc-rebuilt',
    kind: 'jev',
    build: (deps) => buildJevPocRebuiltPlanner(jevDeps(deps), deps.instrument),
  },
};

/** Arms run when `--arm` is not given. */
export const DEFAULT_ARMS: readonly string[] = ['baseline', 'jev-poc'];

const ALIASES: Readonly<Record<string, string>> = { jev: 'jev-poc' };

/**
 * The arms named, in the order given. Aliases resolve to their arm, and a
 * name repeated (directly or through an alias) keeps its first position:
 * two columns of the same arm would share one output directory.
 *
 * @throws {Error} On an unknown name or an empty list.
 */
export function resolveArms(names: readonly string[]): readonly Arm[] {
  if (names.length === 0) throw new Error('name at least one arm');
  const resolved: Arm[] = [];
  for (const name of names) {
    const arm = arms[ALIASES[name] ?? name];
    if (arm === undefined)
      throw new Error(`unknown arm ${name}; known arms: ${known()}`);
    if (!resolved.includes(arm)) resolved.push(arm);
  }
  return resolved;
}

/** The LLM planner every arm uses as its baseline or fallback, prompted like the demo. */
export function demoLlmPlanner(adapter: AnyTextAdapter) {
  return llmPlanner({
    adapter,
    prompt: { system: { rules: { append: SYSTEM_RULES } } },
  });
}

/** The stage library's dependencies for one turn, with the completion call on the `complete` role. */
export function jevDeps(deps: ArmDeps): JevDeps {
  return createJevDeps({
    typesafe: deps.typesafe,
    adapter: deps.adapter('complete'),
    fallback: deps.fallback,
  });
}

function known(): string {
  return Object.keys(arms)
    .map((name) => {
      const aliases = Object.entries(ALIASES)
        .filter(([, target]) => target === name)
        .map(([alias]) => alias);
      return aliases.length > 0
        ? `${name} (alias ${aliases.join(', ')})`
        : name;
    })
    .join(', ');
}
