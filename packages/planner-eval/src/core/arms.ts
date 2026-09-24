import type { Arm, PlannerEvalPlugin } from './plugin.js';

/** An arm with the plugin that registered it, as the runner selects them. */
export interface RegisteredArm {
  readonly arm: Arm;
  readonly plugin: PlannerEvalPlugin;
}

/**
 * Every arm of every plugin, by name, in registration order.
 *
 * @throws {Error} When two arms share a name, within or across plugins.
 */
export function armRegistry(
  plugins: readonly PlannerEvalPlugin[],
): ReadonlyMap<string, RegisteredArm> {
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
