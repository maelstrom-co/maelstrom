import { runGraderValidateCli } from '../core/grader-validate.js';
import { jevPlugin } from '../plugins/jev/plugin.js';
import { llmPlugin } from '../plugins/llm/plugin.js';

await runGraderValidateCli([llmPlugin, jevPlugin], process.argv);
