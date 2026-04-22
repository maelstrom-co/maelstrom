import type {
  ActionExecution,
  GridLayout,
  TilingLayout,
} from '@maelstrom-co/protocol';

export interface SetLayoutCommand {
  kind: 'set_layout';
  layout: GridLayout | TilingLayout;
}

export interface ExecuteActionsCommand {
  kind: 'execute_actions';
  executionPlan: readonly ActionExecution[];
}

export type Command = SetLayoutCommand | ExecuteActionsCommand;
