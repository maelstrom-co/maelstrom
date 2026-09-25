import type { PlannerEvalPlugin } from '../core/plugin.js';
import { jevPlugin } from './jev/plugin.js';
import { llmPlugin } from './llm/plugin.js';

/**
 * Every plugin the eval entry points register, in registration order: the
 * full-planner eval, the report and grader-validation CLIs, and the stage
 * eval, which offers every plugin's `stageModules`. A new plugin is added
 * here and nowhere else.
 */
export const evalPlugins: readonly PlannerEvalPlugin[] = [llmPlugin, jevPlugin];
