import { runReportCli } from '../core/report-cli.js';
import { jevPlugin } from '../plugins/jev/plugin.js';
import { llmPlugin } from '../plugins/llm/plugin.js';

await runReportCli([llmPlugin, jevPlugin], process.argv);
