import type {
  ActionExecution,
  GridLayout,
  MessageId,
  TilingLayout,
} from '@maelstrom-co/protocol';

/** Applies a layout and reconciles retained Instances before the next command. */
export interface SetLayoutCommand {
  /** Dispatches to layout reconciliation. */
  kind: 'set_layout';
  /** Diagnostic correlation; never changes command execution. */
  requestId?: MessageId;
  /** Grid layouts reuse retained metadata; tiling layouts replace it from `instances`. */
  layout: GridLayout | TilingLayout;
}

/** Executes different Instances concurrently and each Instance's Actions in order. */
export interface ExecuteActionsCommand {
  /** Dispatches to Action execution. */
  kind: 'execute_actions';
  /** Diagnostic correlation; never changes command execution. */
  requestId?: MessageId;
  /** Plan order is preserved only among Actions targeting the same Instance. */
  executionPlan: readonly ActionExecution[];
}

/** Queue command discriminated by `kind`; command batches preserve command order. */
export type Command = SetLayoutCommand | ExecuteActionsCommand;
