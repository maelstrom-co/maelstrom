import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveTtsCacheDir } from './tts-cache-dir.ts';

const voiceRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(voiceRoot, '../../../..');
const artifactRoot = join(repositoryRoot, 'apps/demo/dist/docker-voice');
const reportPath = join(artifactRoot, 'report/index.html');
const voiceDevtoolsImage = 'ghcr.io/maelstrom-co/voice-devtools:0.1.0';
const fixtures = ['only-tasks', 'put-it-back', 'open-calendar'] as const;
const forwardedRunnerEnvironment = [
  'MAELSTROM_E2E_OPENAI_API_KEY',
  'MAELSTROM_APP_PORT',
  'MAELSTROM_WS_PORT',
  'MAELSTROM_HOST',
] as const;
const forwardedTtsEnvironment = [
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
] as const;
const privateEnvironment = [
  'MAELSTROM_E2E_OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
] as const;

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

let activeChild: ReturnType<typeof spawn> | undefined;
let receivedSignal: NodeJS.Signals | undefined;

function redact(text: string): string {
  let safe = text;
  for (const name of privateEnvironment) {
    const secret = process.env[name];
    if (secret) safe = safe.replaceAll(secret, '[REDACTED]');
  }
  return safe;
}

function runProcess(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    activeChild = child;
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      if (activeChild === child) activeChild = undefined;
      reject(error);
    });
    child.once('close', (code) => {
      if (activeChild === child) activeChild = undefined;
      resolveResult({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runDocker(
  args: string[],
  options: { readonly allowFailure?: boolean; readonly quiet?: boolean } = {},
): Promise<CommandResult> {
  const result = await runProcess('docker', args);
  if (!options.quiet) {
    if (result.stdout) process.stdout.write(redact(result.stdout));
    if (result.stderr) process.stderr.write(redact(result.stderr));
  }
  if (result.code !== 0 && !options.allowFailure) {
    throw new Error(`docker ${args[0]} exited with status ${result.code}.`);
  }
  return result;
}

function mount(source: string, destination: string, readOnly = false): string {
  if (/[\r\n,]/.test(source)) {
    throw new Error(
      'Docker bind-mount paths must not contain commas or line breaks.',
    );
  }
  return `type=bind,src=${source},dst=${destination}${readOnly ? ',readonly' : ''}`;
}

function onInterrupt(signal: NodeJS.Signals): void {
  receivedSignal = signal;
  activeChild?.kill('SIGTERM');
}

async function prepareFixtures(
  fixtureDirectory: string,
  cacheDirectory: string,
) {
  const provider = process.env.TTS_PROVIDER || 'elevenlabs';
  for (const fixture of fixtures) {
    const text = (
      await readFile(join(voiceRoot, 'tests/audio', `${fixture}.txt`), 'utf8')
    ).trim();
    if (!text) throw new Error(`Audio fixture text is empty: ${fixture}.txt`);

    console.log(`Preparing voice fixture: ${fixture}`);
    const args = [
      'run',
      '--rm',
      '--mount',
      mount(cacheDirectory, '/cache/tts2mic'),
      '--mount',
      mount(fixtureDirectory, '/work/audio'),
      '--env',
      `TTS_PROVIDER=${provider}`,
      '--env',
      'TTS_CACHE_DIR=/cache/tts2mic',
      '--env',
      `ELEVENLABS_OUTPUT_FORMAT=${process.env.ELEVENLABS_OUTPUT_FORMAT || 'pcm_16000'}`,
    ];
    for (const name of forwardedTtsEnvironment) {
      if (process.env[name] !== undefined) args.push('--env', name);
    }
    args.push(
      '--entrypoint',
      '/usr/local/bin/tts2mic-mcp',
      voiceDevtoolsImage,
      'prepare',
      '--text',
      text,
      '--out',
      `/work/audio/${fixture}.wav`,
    );
    await runDocker(args);
    await access(join(fixtureDirectory, `${fixture}.wav`));
  }
}

async function collectArtifacts(runnerName: string): Promise<number> {
  let status = 0;
  const copy = await runDocker(
    ['cp', `${runnerName}:/work/artifacts/.`, artifactRoot],
    { allowFailure: true },
  );
  if (copy.code !== 0) status = copy.code || 1;

  const logs = await runDocker(['logs', runnerName], {
    allowFailure: true,
    quiet: true,
  });
  await writeFile(
    join(artifactRoot, 'docker.log'),
    redact(`${logs.stdout}${logs.stderr}`),
  );
  if (logs.code !== 0 && status === 0) status = logs.code || 1;
  return status;
}

async function main(): Promise<number> {
  const runId = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const label = `maelstrom.voice.run=${runId}`;
  const image = `maelstrom-voice-test:${runId}`;
  const runnerName = `maelstrom-voice-${runId}`;
  const cacheDirectory = await resolveTtsCacheDir(repositoryRoot, {
    override: process.env.MAELSTROM_TTS_CACHE_DIR,
    xdgCacheHome: process.env.XDG_CACHE_HOME,
    home: process.env.HOME,
    workingDirectory: process.cwd(),
  });
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), 'maelstrom-voice-audio-'),
  );

  let imageBuilt = false;
  let runnerCreated = false;
  let testStatus = 0;
  let artifactStatus = 0;
  const onSigint = () => onInterrupt('SIGINT');
  const onSigterm = () => onInterrupt('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  try {
    await rm(artifactRoot, { recursive: true, force: true });
    await mkdir(artifactRoot, { recursive: true });
    await prepareFixtures(fixtureDirectory, cacheDirectory);

    console.log('Building voice E2E container.');
    await runDocker(['build', '--tag', image, voiceRoot]);
    imageBuilt = true;

    const createArgs = [
      'create',
      '--name',
      runnerName,
      '--label',
      label,
      '--init',
      '--shm-size=1g',
    ];
    for (const name of forwardedRunnerEnvironment) {
      if (process.env[name] !== undefined) createArgs.push('--env', name);
    }
    if (process.env.MAELSTROM_BASE_URL?.trim()) {
      createArgs.push('--env', 'MAELSTROM_BASE_URL');
    }
    createArgs.push(
      '--mount',
      mount(fixtureDirectory, '/work/maelstrom/audio', true),
      image,
    );
    await runDocker(createArgs, { quiet: true });
    runnerCreated = true;

    console.log('Running Playwright voice scenarios in Docker.');
    const result = await runDocker(['start', '--attach', runnerName], {
      allowFailure: true,
    });
    testStatus = result.code;
    if (receivedSignal) testStatus = receivedSignal === 'SIGINT' ? 130 : 143;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${redact(message)}\n`);
    testStatus = receivedSignal === 'SIGINT' ? 130 : receivedSignal ? 143 : 1;
  } finally {
    if (runnerCreated) {
      try {
        artifactStatus = await collectArtifacts(runnerName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${redact(message)}\n`);
        artifactStatus = 1;
      }
      await runDocker(['rm', '--force', runnerName], {
        allowFailure: true,
        quiet: true,
      });
    }
    if (imageBuilt) {
      await runDocker(['image', 'rm', '--force', image], {
        allowFailure: true,
        quiet: true,
      });
    }
    await rm(fixtureDirectory, { recursive: true, force: true });
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }

  try {
    await access(reportPath);
    if (process.platform === 'darwin') {
      const opened = await runProcess('open', [reportPath]);
      if (opened.stdout) process.stdout.write(redact(opened.stdout));
      if (opened.stderr) process.stderr.write(redact(opened.stderr));
      if (opened.code !== 0 && testStatus === 0 && artifactStatus === 0) {
        artifactStatus = opened.code || 1;
      }
    }
  } catch {
    if (testStatus === 0 && artifactStatus === 0) artifactStatus = 1;
  }

  return testStatus || artifactStatus;
}

const status = await main();
process.exitCode = status;
