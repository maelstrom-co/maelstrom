import type {
  ActionExecution,
  GridLayout,
  TilingLayout,
} from '@maelstrom-co/protocol-old';

export interface SetLayoutCommand {
  kind: 'set_layout';
  layout: GridLayout | TilingLayout;
}

export interface ExecuteActionsCommand {
  kind: 'execute_actions';
  executionPlan: ActionExecution[];
}

export type Command = SetLayoutCommand | ExecuteActionsCommand;
