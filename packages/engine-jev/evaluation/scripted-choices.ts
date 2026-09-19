export interface ScriptPayload {
  readonly state: Record<string, unknown>;
  readonly questions: Readonly<
    Record<string, { readonly criteria: Readonly<Record<string, string>> }>
  >;
}
export function selectionChoices(
  payload: ScriptPayload,
  selections: Readonly<Record<string, string>>,
): Record<string, string> {
  const candidates = payload.state.currentInstances as readonly {
    instanceId: string;
    vesselId: string;
    variant: string;
    fresh: boolean;
  }[];
  const choices: Record<string, string> = {
    scope: selections.scope ?? 'supported',
  };
  if (
    Object.entries(selections).some(
      ([key, value]) => key.startsWith('create/') && value === 'overflow',
    )
  )
    choices.scope = 'unsupported';
  for (const id of Object.keys(payload.questions)) {
    if (id.startsWith('new/')) {
      const vessel = (
        payload.state.availableVessels as {
          id: string;
          defaultVariant: string;
        }[]
      ).find((vessel) => vessel.id === id.slice(4));
      if (!vessel) throw new Error('script vessel missing');
      const count = Number(selections[`create/${vessel.id}`] ?? 0);
      choices[id] =
        count === 1
          ? `one/${vessel.defaultVariant}`
          : count === 2
            ? JSON.stringify([vessel.defaultVariant, vessel.defaultVariant])
            : 'none';
      continue;
    }
    if (!id.startsWith('view/')) continue;
    const candidate = candidates.find(
      (candidate) => candidate.instanceId === id.slice(5),
    );
    if (!candidate) throw new Error('script target is not a candidate');
    const presence =
      selections[`presence/${candidate.instanceId}`] ?? 'unchanged';
    choices[id] =
      selections[id] ??
      (presence === 'unchanged'
        ? 'keep'
        : presence === 'show'
          ? `show/${candidate.variant}`
          : presence);
  }
  return choices;
}
export function layoutChoice(
  payload: ScriptPayload,
  selections: Readonly<Record<string, string>>,
): Record<string, string> {
  const criteria = payload.questions.layout.criteria;
  const wanted = selections.arrangement ?? 'preserve';
  const key =
    wanted === 'focus'
      ? Object.keys(criteria).find(
          (key) =>
            key === `focus/V/${selections.primary}` ||
            key === `focus/H/${selections.primary}`,
        )
      : wanted;
  return {
    layout:
      key && Object.hasOwn(criteria, key)
        ? key
        : wanted === 'preserve'
          ? Object.hasOwn(criteria, 'row')
            ? 'row'
            : Object.keys(criteria)[0]
          : 'unavailable',
  };
}
export function actionChoices(
  payload: ScriptPayload,
  selections: Readonly<Record<string, string>>,
): Record<string, string> {
  const available = payload.state.availableActions as readonly {
    key: string;
    instanceId: string;
    action: string;
  }[];
  return Object.fromEntries(
    Object.keys(payload.questions).map((id) => {
      const target = selections[id];
      const selected = available.find(
        (option) => `${option.instanceId}/${option.action}` === target,
      );
      return [
        id,
        !target || target === 'none'
          ? 'done'
          : (selected?.key ?? 'unsupported'),
      ];
    }),
  );
}
