import type { PlanningInput, Stage } from '@maelstrom-co/engine';
import {
  type ChartRequest,
  getVisibleInstanceIds,
  isErr,
  isOk,
  ok,
} from '@maelstrom-co/protocol';
import type { Ask } from '../ask.js';
import { STAGE_NAME } from '../defer.js';
import {
  type ChoiceQuestion,
  choice,
  noul,
  type Question,
  type Reply,
  readAnswer,
} from '../questions.js';
import type { SelectedInstance } from '../types.js';
import {
  GATE_THRESHOLD,
  NEEDS_ACTIONS_THRESHOLD,
  selectGated,
} from './select-gated.js';
import type { GatedSelection } from './stage-types.js';

const STAGE = STAGE_NAME.jevSelect;

/**
 * The gated selection plus one screen scope question and one hide
 * question per visible instance, asked in the same call, with worked
 * examples on the screen scope and keep questions. When the latest intent
 * adds to or adjusts the screen, a visible instance stays visible unless
 * its hide question answers yes at or above {@link GATE_THRESHOLD}; a
 * targeted instance whose keep question still answered keep is hidden.
 * The `spatial` gate is asked with arrangement words spelled out, and the
 * `needsActions` gate too when
 * {@link ScreenScopeOptions.spelledOutActionsGate} is set; both keep their
 * thresholds. When the intent describes the whole screen, the keep
 * questions decide, as in {@link selectGated}. Hidden and new instances
 * always follow their own questions. Defers exactly as {@link selectGated}
 * does.
 */
export function selectGatedScreenScope(
  ask: Ask,
  options: ScreenScopeOptions = {},
): Stage<PlanningInput, GatedSelection> {
  return async (input, ctx) => {
    const { request } = input;
    const visibleIds: ReadonlySet<string> =
      request.layout.type === 'tiling'
        ? getVisibleInstanceIds(request.layout)
        : new Set<string>();
    let reply: Reply | undefined;
    const askWithScreenScope: Ask = async (stage, evaluation, callCtx) => {
      const result = await ask(
        stage,
        {
          ...evaluation,
          questions: withScreenScope(
            evaluation.questions,
            request,
            visibleIds,
            options,
          ),
        },
        callCtx,
      );
      if (isOk(result)) reply = result.value;
      return result;
    };
    const selected = await selectGated(askWithScreenScope)(input, ctx);
    if (isErr(selected) || reply === undefined) return selected;
    const screen = readAnswer(reply, SCREEN_QUESTION, STAGE, ctx);
    if (isErr(screen)) return screen;
    if (screen.value.choice !== ADDS_OR_ADJUSTS) return selected;

    const instances: SelectedInstance[] = [];
    for (const instance of selected.value.instances) {
      if (instance.fresh || !visibleIds.has(instance.instanceId)) {
        instances.push(instance);
        continue;
      }
      const target = readAnswer(reply, hideQuestionId(instance), STAGE, ctx);
      if (isErr(target)) return target;
      const targeted = (target.value.probability ?? 0) >= GATE_THRESHOLD;
      if (!targeted)
        instances.push({ ...instance, visible: true, decision: 'keep' });
      else if (instance.decision === 'keep')
        instances.push({ ...instance, visible: false, decision: 'hide' });
      else instances.push(instance);
    }
    return ok({ ...selected.value, instances });
  };
}

/** What {@link selectGatedScreenScope} takes beside the provider client. */
export interface ScreenScopeOptions {
  /**
   * Asks `needsActions` with item edits and settings spelled out, with
   * examples. It lifts Decisions on requests that add items, but pushes
   * TypeSafe's answers on requests without actions up to
   * {@link NEEDS_ACTIONS_THRESHOLD}, so it is off by default.
   */
  readonly spelledOutActionsGate?: boolean;
}

const SCREEN_QUESTION = 'screen';
const ADDS_OR_ADJUSTS = 'adds_or_adjusts';

const DELETE_OPTION = {
  what: 'Explicitly delete this instance and its state.',
  not_for: 'hiding, closing or removing a widget from view',
  examples: ['Delete the weather widget', 'Remove the journal for good'],
};

const VISIBLE_OPTIONS = {
  keep: {
    what: 'Keep it visible: the request names or needs it, or only adds to or edits the screen. Its view or content may still change through actions.',
    not_for:
      'a request that hides or removes this widget, or lists a screen without it',
    examples: [
      'Show the map next to the current widgets: keep every widget already shown',
      'Hide the weather: keep every widget except the weather',
      'Give the calendar more space: keep every widget',
      'Show me only the calendar and tasks: keep the calendar and the tasks',
    ],
  },
  hide: {
    what: 'Hide it, retaining its state: the request hides or removes it, or describes a screen without it.',
    not_for:
      'a request that adds, moves, resizes or edits widgets without hiding this one',
    examples: [
      'Hide the weather: hide the weather only',
      'Just show me the calendar: hide every widget except the calendar',
      'Close the tasks: hide the tasks',
    ],
  },
  delete: DELETE_OPTION,
};

const HIDDEN_OPTIONS = {
  keep: {
    what: 'Show it: the instance and its state become visible again.',
    not_for: 'a request that does not name or need this widget',
    examples: [
      'Show the map: show the map',
      'Bring the journal back: show the journal',
    ],
  },
  hide: {
    what: 'Leave it hidden, retaining its state.',
    not_for: 'a request that asks to show or bring back this widget',
    examples: [
      'Show the map next to the current widgets: leave every other hidden widget hidden',
      'Hide the weather: leave hidden widgets hidden',
    ],
  },
  delete: DELETE_OPTION,
};

function screenQuestion(): ChoiceQuestion {
  return choice(
    'Does the latest intent describe the whole screen, or add to or adjust what is already shown?',
    {
      [ADDS_OR_ADJUSTS]: {
        what: 'The request adds widgets, shows a hidden one, hides or removes named widgets, changes a view or content, or moves or resizes what is shown. Widgets it does not name stay as they are. A chart resize with no request also counts.',
        not_for:
          'a request that lists the full set of widgets the screen should show, shows two or more widgets together (X and Y side by side, X next to Y), or says only, just, nothing but or instead',
        examples: [
          'Show the map next to the current widgets',
          'Hide the weather',
          'Hide the weather, keep the rest',
          'Add a task to buy milk',
          'Move the calendar to the end of the row',
          'Give the calendar two thirds of the board',
          'Bring the journal back',
        ],
      },
      whole_screen: {
        what: 'The request states the full set of widgets the screen should show, replacing the current set: widgets it does not name or need are hidden. Asking to see two or more named widgets together, side by side or stacked, describes the whole screen unless it says to keep the others.',
        not_for:
          'a request that names widgets only to add, show, hide, move, resize or edit them',
        examples: [
          'Just show me the calendar',
          'Show me the forecast and my week view side by side',
          'I want the tasks and the map next to each other',
          'Only the map and the weather',
          'Show me the calendar and tasks side by side, nothing else',
          'Replace everything with the journal',
          'Hide everything except the tasks',
        ],
      },
    },
  );
}

const ACTIONS_GATE = noul(
  "The latest intent needs a widget action: it adds, removes, checks, moves or edits an item inside a widget (a task, an event, a journal entry), sets or changes what a widget shows (a city, a destination, a route, or a view such as week, day, hourly or route), or opens a widget that must be set to something specific. Adding an item is an action even when the request says add. Needs an action: 'Add a task to pick up the dry cleaning', 'Add lunch with Ana to my calendar', 'Put the gym on my task list', 'Create two tasks: call Mia and pay the bill', 'Move my 9:00 meeting to noon', 'Set the weather to Lisbon', 'Show the calendar in week view', 'Open a second weather widget for Rome'. Needs no action: 'Bring up the journal', 'Hide the tasks', 'Make the map larger', 'Put the calendar on the left', 'Swap two widgets', 'Give the tasks half of the board'.",
);

const SPATIAL_GATE = noul(
  "The latest intent states where widgets go, their order, or how large they are: a side or position, side by side, stacked, above or below, swapping or reversing places, moving to the start or end of a row, or a size or share of the board. A city, place or address inside a widget's content does not count. Spatial: 'Put the map on the left', 'Swap the journal and the weather', 'Reverse the row', 'Show the tasks and the map side by side', 'Give the calendar two thirds'. Not spatial: 'Set the weather to Lisbon', 'Add a task', 'Show the map', 'Hide the journal'.",
);

function withScreenScope(
  questions: Readonly<Record<string, Question>>,
  request: ChartRequest,
  visibleIds: ReadonlySet<string>,
  options: ScreenScopeOptions,
): Record<string, Question> {
  const names = new Map<string, string>(
    request.vessels.map((vessel) => [vessel.id, vessel.name]),
  );
  const next: Record<string, Question> = {};
  for (const [id, question] of Object.entries(questions)) {
    const instanceId = id.startsWith('view/') ? id.slice('view/'.length) : '';
    next[id] =
      instanceId !== '' && question.type === 'choice'
        ? choice(
            question.instructions,
            visibleIds.has(instanceId) ? VISIBLE_OPTIONS : HIDDEN_OPTIONS,
          )
        : question;
  }
  if (
    options.spelledOutActionsGate === true &&
    next['gate/needsActions'] !== undefined
  )
    next['gate/needsActions'] = ACTIONS_GATE;
  if (next['gate/spatial'] !== undefined) next['gate/spatial'] = SPATIAL_GATE;
  next[SCREEN_QUESTION] = screenQuestion();
  for (const instance of request.instances) {
    if (!visibleIds.has(instance.instanceId)) continue;
    const name = names.get(instance.vesselId) ?? instance.vesselId;
    next[hideQuestionId(instance)] = noul(
      `The latest intent explicitly asks to hide, remove, close or delete ${instance.instanceId}, the ${name} widget, by naming it, its widget type, or a clear reference to it such as "that one" or "everything else". Showing, moving, resizing or editing it does not count, and neither does adding other widgets.`,
    );
  }
  return next;
}

function hideQuestionId(instance: { readonly instanceId: string }): string {
  return `hide/${instance.instanceId}`;
}
