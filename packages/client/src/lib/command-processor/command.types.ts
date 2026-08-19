import type {
  ActionExecution,
  GridLayout,
  TilingLayout,
} from '@maelstrom-co/protocol';

/** Command that replaces the retained layout before Actions execute. */
export interface SetLayoutCommand {
  /** Command discriminator. */
  kind: 'set_layout';
  /** Grid or tiling layout to retain and apply. */
  layout: GridLayout | TilingLayout;
}

/** Command that executes an ordered plan of Actions. */
export interface ExecuteActionsCommand {
  /** Command discriminator. */
  kind: 'execute_actions';
  /** Actions to execute in order. */
  executionPlan: readonly ActionExecution[];
}

/** Command accepted by the sequential command processor. */
export type Command = SetLayoutCommand | ExecuteActionsCommand;
