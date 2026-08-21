import { findValeFiles } from './lib/vale-files.ts';

const files = JSON.stringify(await findValeFiles(process.cwd()));
const githubOutput = process.argv.includes('--github-output');

process.stdout.write(githubOutput ? `files=${files}\n` : files);
