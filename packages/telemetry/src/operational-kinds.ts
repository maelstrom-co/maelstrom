/** Built-in operational observation names shared by producers and projection. @internal */
export const operationalKinds = Object.freeze({
  clientRequestStarted: 'client.request.started',
  clientResponseReceived: 'client.response.received',
  clientRequestFailed: 'client.request.failed',
  clientResponseApplied: 'client.response.applied',
  clientResponseFailed: 'client.response.failed',
  clientResponseDiscarded: 'client.response.discarded',
  clientActionCompleted: 'client.action.completed',
  engineRequestStarted: 'engine.request.started',
  engineRequestCompleted: 'engine.request.completed',
  enginePlannerStarted: 'engine.planner.started',
  enginePlannerCompleted: 'engine.planner.completed',
  engineStageStarted: 'engine.stage.started',
  engineStageCompleted: 'engine.stage.completed',
  engineStageFailed: 'engine.stage.failed',
  voiceToolCalled: 'voice.tool.called',
  voiceToolResult: 'voice.tool.result',
  voiceToolCancelled: 'voice.tool.cancelled',
  voiceTelemetryDropped: 'voice.telemetry.dropped',
} as const);

/** One built-in operational observation name. @internal */
export type OperationalKind =
  (typeof operationalKinds)[keyof typeof operationalKinds];
