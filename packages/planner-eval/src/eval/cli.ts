import { runEvalCli } from '../core/cli.js';
import { jevPlugin } from '../plugins/jev/plugin.js';
import { llmPlugin } from '../plugins/llm/plugin.js';

await runEvalCli([llmPlugin, jevPlugin], process.argv);
