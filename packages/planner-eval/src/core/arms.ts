import { type Arm, isPhase, type PlannerEvalPlugin } from './plugin.js';

/** An arm with the plugin that registered it, as the runner selects them. */
export interface RegisteredArm {
  readonly arm: Arm;
  readonly plugin: PlannerEvalPlugin;
}

/**
 * Every arm of every plugin, by name, in registration order.
 *
 * @throws {Error} When two arms share a name, within or across plugins, or
 *   when a plugin is inconsistent (see {@link pluginProblems}).
 */
export function armRegistry(
  plugins: readonly PlannerEvalPlugin[],
): ReadonlyMap<string, RegisteredArm> {
  const problems = plugins.flatMap(pluginProblems);
  if (problems.length > 0) throw new Error(problems.join('; '));
  const registry = new Map<string, RegisteredArm>();
  for (const plugin of plugins)
    for (const arm of plugin.arms) {
      if (registry.has(arm.name))
        throw new Error(`arm ${arm.name} is registered twice`);
      registry.set(arm.name, { arm, plugin });
    }
  return registry;
}

/** The arms run when `--arm` is not given: every plugin's defaults, in registration order. */
export function defaultArms(
  plugins: readonly PlannerEvalPlugin[],
): readonly string[] {
  return plugins.flatMap((plugin) => plugin.defaultArms ?? []);
}

/**
 * The arms named, in the order given. Aliases resolve to their arm, and a
 * name repeated (directly or through an alias) keeps its first position:
 * two columns of the same arm would share one output directory.
 *
 * @throws {Error} On an unknown name or an empty list.
 */
export function resolveArms(
  plugins: readonly PlannerEvalPlugin[],
  names: readonly string[],
): readonly RegisteredArm[] {
  if (names.length === 0) throw new Error('name at least one arm');
  const registry = armRegistry(plugins);
  const aliases = Object.assign(
    {},
    ...plugins.map((plugin) => plugin.aliases ?? {}),
  ) as Readonly<Record<string, string>>;
  const resolved: RegisteredArm[] = [];
  for (const name of names) {
    const registered = registry.get(aliases[name] ?? name);
    if (registered === undefined)
      throw new Error(
        `unknown arm ${name}; known arms: ${known(registry, aliases)}`,
      );
    if (!resolved.includes(registered)) resolved.push(registered);
  }
  return resolved;
}

/**
 * What makes `plugin` inconsistent, one line each: a key of `phases` that
 * is no planner-neutral phase or maps to a stage missing from `stageOrder`, and a
 * default arm or alias target the plugin does not register. Empty when
 * the plugin is consistent.
 */
export function pluginProblems(plugin: PlannerEvalPlugin): readonly string[] {
  const problems: string[] = [];
  const order: readonly string[] = plugin.stageOrder ?? [];
  for (const [phase, stage] of Object.entries(plugin.phases ?? {})) {
    if (!isPhase(phase))
      problems.push(`plugin ${plugin.name} maps unknown phase ${phase}`);
    else if (stage === undefined || !order.includes(stage))
      problems.push(
        `plugin ${plugin.name} maps phase ${phase} to ${stage}, which is not in its stageOrder`,
      );
  }
  const owned = new Set(plugin.arms.map((arm) => arm.name));
  for (const name of plugin.defaultArms ?? [])
    if (!owned.has(name))
      problems.push(
        `plugin ${plugin.name} runs ${name} by default but registers no such arm`,
      );
  for (const [alias, target] of Object.entries(plugin.aliases ?? {}))
    if (!owned.has(target))
      problems.push(
        `plugin ${plugin.name} aliases ${alias} to ${target} but registers no such arm`,
      );
  return problems;
}

/** The plugin that registered the arm named `name`, when any did. */
export function pluginOf(
  plugins: readonly PlannerEvalPlugin[],
  name: string,
): PlannerEvalPlugin | undefined {
  return plugins.find((plugin) => plugin.arms.some((arm) => arm.name === name));
}

function known(
  registry: ReadonlyMap<string, RegisteredArm>,
  aliases: Readonly<Record<string, string>>,
): string {
  return [...registry.keys()]
    .map((name) => {
      const own = Object.entries(aliases)
        .filter(([, target]) => target === name)
        .map(([alias]) => alias);
      return own.length > 0 ? `${name} (alias ${own.join(', ')})` : name;
    })
    .join(', ');
}
