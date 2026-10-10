import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectedPreparedManifest } from './calibrate-cases';
import {
  buildCaseInput,
  type CaseId,
  caseRegistry,
  gradeCaseEvidence,
} from './cases';
import {
  candidateGraderEvidence,
  diff,
  evaluateCase,
  evaluateModeling,
  extractClaudeResult,
  extractOpenCodeResult,
  extractPiAssistantText,
  gradeCandidate,
  isDisposableArtifactChange,
  type RunResult,
  resolveCommand,
  runCommand,
  snapshotCandidate,
} from './index';

let root: string;
let fakePi: string;
let oldPi: string | undefined;
let oldClaude: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'evaluation-test-'));
  fakePi = join(root, 'fake-pi.mjs');
  oldPi = process.env.PI_CLI;
  oldClaude = process.env.CLAUDE_CLI;
  process.env.PI_CLI = fakePi;
  process.env.CLAUDE_CLI = fakePi;
});

afterEach(async () => {
  if (oldPi === undefined) delete process.env.PI_CLI;
  else process.env.PI_CLI = oldPi;
  if (oldClaude === undefined) delete process.env.CLAUDE_CLI;
  else process.env.CLAUDE_CLI = oldClaude;
  await rm(root, { recursive: true, force: true });
});

async function fake(source: string) {
  await writeFile(fakePi, `#!/usr/bin/env node\n${source}\n`);
  await chmod(fakePi, 0o700);
}

const options = () => ({
  output: join(root, 'private-output'),
  runner: 'pi' as const,
});

const genericOptions = () => ({
  output: join(root, 'generic-output'),
  runner: 'command' as const,
  command: { executable: fakePi, args: [] },
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      await stat(path);
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForGraderPid(
  path: string,
  evaluation: Promise<RunResult>,
  controller: AbortController,
): Promise<number> {
  const settled = evaluation.then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  // Runner, typecheck, and behavior each have their own 1500ms deadline.
  const deadline = performance.now() + 5000;
  try {
    while (performance.now() < deadline) {
      const outcome = await Promise.race([
        settled,
        new Promise<undefined>((resolveDelay) =>
          setTimeout(() => resolveDelay(undefined), 10),
        ),
      ]);
      if (outcome)
        throw new Error('Evaluation settled before grader readiness');
      let marker: string;
      try {
        marker = await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const pid = Number(marker);
      if (!/^\d+$/.test(marker) || !Number.isSafeInteger(pid) || pid <= 0)
        throw new Error('Invalid grader PID marker');
      if (!isProcessAlive(pid))
        throw new Error('Grader exited before readiness');
      return pid;
    }
    throw new Error('Timed out waiting for grader readiness');
  } catch (error) {
    controller.abort();
    const outcome = await settled;
    const result = outcome.result;
    const grade = result?.manifest.candidateGrader as
      | ReturnType<typeof candidateGraderEvidence>
      | null
      | undefined;
    const evidence = result
      ? {
          status: result.status,
          timedOut: result.timedOut,
          cancelled: result.cancelled,
          spawnError: result.spawnError ?? null,
          inspectionError: result.inspectionError ?? null,
          commands: grade?.commands.map((command) => ({
            status: command.status,
            timedOut: command.timedOut,
            cancelled: command.cancelled,
            spawnError: command.spawnError,
            processEvidence: command.processEvidence,
          })),
        }
      : { rejection: String(outcome.error).slice(-2000) };
    throw new Error(
      `${String(error)}; ${JSON.stringify(evidence).slice(-8000)}`,
    );
  }
}

describe('registered behavioral cases', () => {
  for (const scenario of [
    'typecheck',
    'behavior',
    'delayed behavior',
    'early-exit behavior',
  ] as const) {
    const stage = scenario === 'typecheck' ? 'typecheck' : 'behavior';
    const startupDelayMs = scenario === 'delayed behavior' ? 900 : 0;
    test(scenario === 'early-exit behavior'
      ? 'grader readiness fails promptly with early-exit command evidence'
      : `cancelling ${scenario} stops grading and preserves the cancellation in the report`, async () => {
      const candidateRoot = join(root, 'conversion');
      await cp(
        join(import.meta.dir, '../acceptance/fixtures/migration-react'),
        candidateRoot,
        { recursive: true },
      );
      const manifest = JSON.parse(
        await readFile(join(candidateRoot, 'package.json.fixture'), 'utf8'),
      );
      await rm(join(candidateRoot, 'package.json.fixture'));
      await writeFile(
        join(candidateRoot, 'package.json'),
        `${JSON.stringify(expectedPreparedManifest(manifest), null, 2)}\n`,
      );
      const bin = join(candidateRoot, 'node_modules/.bin');
      await mkdir(bin, { recursive: true });
      const started = join(root, 'grader.pid');
      const laterCheck = join(root, 'behavior-started');
      const hangingGrader = `#!/usr/bin/env node\nconst fs = require('node:fs'); const marker = ${JSON.stringify(started)}; fs.writeFileSync(marker + '.tmp', String(process.pid)); fs.renameSync(marker + '.tmp', marker); setInterval(() => {}, 1000);`;
      await writeFile(
        join(bin, 'tsc'),
        stage === 'typecheck'
          ? hangingGrader
          : `#!${startupDelayMs ? process.execPath : '/usr/bin/env node'}\nsetTimeout(() => process.exit(0), ${startupDelayMs});`,
        { mode: 0o700 },
      );
      await writeFile(
        join(bin, 'vitest'),
        scenario === 'early-exit behavior'
          ? '#!/usr/bin/env node\nconsole.error("fixture behavior failed before readiness"); process.exit(1);'
          : stage === 'behavior'
            ? hangingGrader
            : `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(laterCheck)}, 'started'); process.exit(1);`,
        { mode: 0o700 },
      );
      await writeFile(
        fakePi,
        `#!${startupDelayMs ? process.execPath : '/usr/bin/env node'}\nprocess.stdin.resume(); process.stdin.on('end', () => setTimeout(() => console.log('done'), ${startupDelayMs}));`,
        { mode: 0o700 },
      );
      const controller = new AbortController();
      const evaluationStartedAt = performance.now();
      const evaluation = evaluateCase('react-conversion', {
        ...genericOptions(),
        candidateRoot,
        executionAuthorization: 'operator-approved',
        signal: controller.signal,
        timeoutMs: 1500,
      });
      try {
        if (scenario === 'early-exit behavior') {
          await expect(
            waitForGraderPid(started, evaluation, controller),
          ).rejects.toThrow(
            /Evaluation settled before grader readiness.*fixture behavior failed before readiness/,
          );
          expect(performance.now() - evaluationStartedAt).toBeLessThan(5000);
          const result = await evaluation;
          expect(result.status).toBe('completed');
          expect(result.cancelled).toBe(false);
          expect(result.manifest.candidateGrader).toMatchObject({
            commands: [
              {
                exitCode: 0,
                timedOut: false,
                cancelled: false,
                spawnError: null,
              },
              {
                exitCode: 1,
                timedOut: false,
                cancelled: false,
                spawnError: null,
              },
            ],
          });
          await expect(stat(started)).rejects.toThrow();
          await expect(
            stat(join(candidateRoot, '.evaluation-grade')),
          ).rejects.toThrow();
          return;
        }
        const pid = await waitForGraderPid(started, evaluation, controller);
        expect(isProcessAlive(pid)).toBe(true);
        if (startupDelayMs) {
          expect(performance.now() - evaluationStartedAt).toBeGreaterThan(2000);
        }
        controller.abort();
        const result = await evaluation;
        expect(result.status).toBe('cancelled');
        expect(result.cancelled).toBe(true);
        expect(result.timedOut).toBe(false);
        expect(result.spawnError).toBeUndefined();
        expect(result.inspectionError).toBeUndefined();
        expect(result.manifest.candidateGrader).toMatchObject({
          harnessStatus: 'blocked',
          commands:
            stage === 'typecheck'
              ? [
                  {
                    status: 'cancelled',
                    cancelled: true,
                    timedOut: false,
                    spawnError: null,
                  },
                ]
              : [
                  {
                    status: 'completed',
                    exitCode: 0,
                    cancelled: false,
                    timedOut: false,
                    spawnError: null,
                  },
                  {
                    status: 'cancelled',
                    cancelled: true,
                    timedOut: false,
                    spawnError: null,
                  },
                ],
        });
        expect(
          result.criteria.find(({ id }) => id === 'trusted-ui-behavior')
            ?.status,
        ).toBe(stage === 'typecheck' ? 'unrun' : 'failed');
        expect(
          result.criteria.find(({ id }) => id === 'browser-chart-vessel')
            ?.status,
        ).toBe('unrun');
        await expect(
          stat(join(candidateRoot, '.evaluation-grade')),
        ).rejects.toThrow();
        await expect(stat(laterCheck)).rejects.toThrow();
        expect(isProcessAlive(pid)).toBe(false);
        const { privateOutputDirectory } = result.manifest.security as {
          privateOutputDirectory: string;
        };
        const persisted = JSON.parse(
          await readFile(join(privateOutputDirectory, 'manifest.json'), 'utf8'),
        );
        expect(persisted).toEqual(result.manifest);
        expect(persisted.process).toMatchObject({
          cancelled: true,
          timedOut: false,
        });
      } finally {
        controller.abort();
        await evaluation.catch(() => undefined);
      }
    }, 10_000);
  }

  test('rejects candidate/output overlap and read-only candidates before creating output', async () => {
    const candidate = join(root, 'candidate');
    await mkdir(candidate, { recursive: true });
    await expect(
      evaluateCase('onboarding-implementation', {
        ...genericOptions(),
        output: join(candidate, 'out'),
        candidateRoot: candidate,
        executionAuthorization: 'operator-approved',
      }),
    ).rejects.toThrow('Output directory must not overlap');
    await expect(
      evaluateCase('modeling-read-only', {
        ...genericOptions(),
        output: join(root, 'readonly-out'),
        candidateRoot: candidate,
      }),
    ).rejects.toThrow('Read-only cases cannot use a candidateRoot');
    await expect(readdir(root)).resolves.not.toContain('readonly-out');
  });
  test('registers five cases with canonical prompt ids and explicit execution modes', () => {
    expect(Object.keys(caseRegistry).sort()).toEqual([
      'debugging-read-only',
      'modeling-read-only',
      'onboarding-implementation',
      'react-conversion',
      'react-inventory',
    ]);
    expect(caseRegistry['react-inventory'].promptId).toBe(
      'maelstrom-react-inventory',
    );
    expect(caseRegistry['react-conversion'].mode).toBe('implementation');
  });

  test('constructs actual canonical prompt and fixture inputs for all five cases', async () => {
    const ids = Object.keys(caseRegistry) as CaseId[];
    expect(ids).toHaveLength(5);
    for (const id of ids) {
      const built = await buildCaseInput(id);
      expect(built.prompt.id).toBe(caseRegistry[id].promptId);
      expect(built.prompt.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(built.fixtureFiles.map((file) => file.path)).toEqual(
        caseRegistry[id].files.map((file) => file.path),
      );
      expect(
        built.fixtureFiles.every((file) => file.sha256.length === 64),
      ).toBe(true);
      expect(built.inputSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(built.input).toContain(caseRegistry[id].task);
      expect(built.input).toContain(
        'Evidence output contract (exact JSON schema; no extra keys)',
      );
      expect(built.input).toContain('4–300 Unicode code points inclusive');
      expect(built.input).toContain(
        'exact, case-sensitive, contiguous substring',
      );
      expect(built.input).not.toMatch(
        /\\[(PRODUCT GOAL|PATH|USER GOAL|GOAL AND LIMITS|APPROVED INVENTORY / PLAN)\\]/,
      );
    }
    const onboarding = await buildCaseInput('onboarding-implementation');
    expect(onboarding.input).toContain(
      'package.json (staged from package.json.fixture)',
    );
    expect(onboarding.input.toLowerCase()).toContain(
      'do not add or claim search behavior',
    );
    expect(onboarding.input).not.toContain('src/SearchPanel.tsx');
    expect((await buildCaseInput('react-conversion')).prompt.id).toBe(
      'maelstrom-react-conversion',
    );
  });

  test('builds a per-process OpenCode primary-agent deny policy and explicit coding allowlist without global mutations', () => {
    const before = process.env.OPENCODE_PERMISSION;
    const openCode = resolveCommand({
      runner: 'opencode',
      toolAccess: 'disabled',
    });
    expect(openCode.invocation.args.slice(0, 4)).toEqual([
      '--pure',
      'run',
      '--format',
      'json',
    ]);
    const agentArg = openCode.invocation.args.indexOf('--agent');
    const agentName = openCode.invocation.args[agentArg + 1]!;
    const content = JSON.parse(
      openCode.invocationEnv?.OPENCODE_CONFIG_CONTENT ?? '{}',
    );
    expect(content.agent[agentName]).toMatchObject({
      mode: 'primary',
      permission: { '*': 'deny', task: 'deny', edit: 'deny' },
    });
    expect(content.agent[agentName]).not.toHaveProperty('model');
    expect(
      JSON.parse(openCode.invocationEnv?.OPENCODE_PERMISSION ?? '{}')['*'],
    ).toBe('deny');
    const coding = resolveCommand({
      runner: 'opencode',
      toolAccess: 'enabled',
    });
    const codingAgent =
      coding.invocation.args[coding.invocation.args.indexOf('--agent') + 1]!;
    const codingContent = JSON.parse(
      coding.invocationEnv?.OPENCODE_CONFIG_CONTENT ?? '{}',
    );
    expect(codingContent.agent[codingAgent].permission).toMatchObject({
      '*': 'deny',
      edit: 'allow',
      task: 'deny',
    });
    expect(process.env.OPENCODE_PERMISSION).toBe(before);
    const claude = resolveCommand({ runner: 'claude', toolAccess: 'disabled' });
    expect(claude.invocation.args).toContain('');
    expect(claude.invocation.args).toContain('mcp__*');
  });

  test('OpenCode preserves inline JSONC config in its child profile without exposing it in artifacts', async () => {
    const previous = process.env.OPENCODE_CONFIG_CONTENT;
    const previousCli = process.env.OPENCODE_CLI;
    process.env.OPENCODE_CLI = fakePi;
    const marker = 'fake-token-sentinel-never-publish';
    const inline = `{
      // Existing user configuration must survive the evaluator overlay.
      "model": "provider/model-id",
      "provider": { "provider-id": { "options": { "baseURL": "https://provider.invalid", "apiKey": "${marker}" } } },
      "agent": { "operator-agent": { "mode": "primary", "model": { "providerID": "provider-id", "modelID": "model-id" } } },
    }`;
    process.env.OPENCODE_CONFIG_CONTENT = inline;
    await fake(`
if (process.argv.includes('--version')) { console.log('1.18.32-fake'); process.exit(0); }
const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
if (config.model !== 'provider/model-id' || config.provider['provider-id'].options.apiKey !== ${JSON.stringify(marker)} || !config.agent['operator-agent'] || config.agent[process.argv.at(-1)]?.permission['*'] !== 'deny') process.exit(9);
const sessionID = 'session-config'; const messageID = 'message-config';
console.log(JSON.stringify({ type: 'step_start', sessionID, part: { type: 'step-start', sessionID, messageID } }));
console.log(JSON.stringify({ type: 'text', sessionID, part: { type: 'text', sessionID, messageID, text: 'safe answer', time: { end: 1 } } }));
console.log(JSON.stringify({ type: 'step_finish', sessionID, part: { type: 'step-finish', sessionID, messageID, reason: 'stop' } }));
process.exit(0);`);
    try {
      const result = await evaluateCase('modeling-read-only', {
        output: join(root, 'opencode-config-output'),
        runner: 'opencode',
      });
      expect(result.exitCode).toBe(0);
      const artifactDir = (
        result.manifest.security as { privateOutputDirectory: string }
      ).privateOutputDirectory;
      const artifactText = [
        JSON.stringify(result.manifest),
        result.stdout,
        result.stderr,
        await readFile(join(artifactDir, 'manifest.json'), 'utf8'),
        await readFile(join(artifactDir, 'stdout.jsonl'), 'utf8'),
        await readFile(join(artifactDir, 'stderr.txt'), 'utf8'),
      ].join('\\n');
      expect(artifactText).not.toContain(marker);
      expect(process.env.OPENCODE_CONFIG_CONTENT).toBe(inline);
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CONFIG_CONTENT;
      else process.env.OPENCODE_CONFIG_CONTENT = previous;
      if (previousCli === undefined) delete process.env.OPENCODE_CLI;
      else process.env.OPENCODE_CLI = previousCli;
    }
  });

  test('rejects invalid OpenCode inline config before allocating output or spawning, without echoing it', async () => {
    const previous = process.env.OPENCODE_CONFIG_CONTENT;
    const previousCli = process.env.OPENCODE_CLI;
    process.env.OPENCODE_CLI = fakePi;
    const secret = 'private-sentinel-invalid-jsonc';
    const output = join(root, 'invalid-opencode-config-output');
    process.env.OPENCODE_CONFIG_CONTENT = `{ broken ${secret}`;
    await fake(
      `(await import('node:fs')).writeFileSync(${JSON.stringify(join(root, 'unexpected-spawn'))}, 'started');`,
    );
    try {
      const rejection = await evaluateCase('modeling-read-only', {
        output,
        runner: 'opencode',
      }).then(
        () => '',
        (error: unknown) => String(error),
      );
      expect(rejection).toContain('contents were not logged');
      expect(rejection).not.toContain(secret);
      await expect(stat(output)).rejects.toThrow();
      await expect(stat(join(root, 'unexpected-spawn'))).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CONFIG_CONTENT;
      else process.env.OPENCODE_CONFIG_CONTENT = previous;
      if (previousCli === undefined) delete process.env.OPENCODE_CLI;
      else process.env.OPENCODE_CLI = previousCli;
    }
  });

  test('OpenCode adapter sends stdin with the selected primary agent and child-only policy argv', async () => {
    const adapter = resolveCommand({
      runner: 'opencode',
      toolAccess: 'disabled',
    });
    const cwd = join(root, 'opencode-cwd');
    await (await import('node:fs/promises')).mkdir(cwd);
    const agent = adapter.invocation.args.at(-1)!;
    const sessionID = 'session-smoke';
    const messageID = 'message-smoke';
    const answer = 'adapter fixture answer';
    const startEvent = JSON.stringify({
      type: 'step_start',
      sessionID,
      part: { type: 'step-start', sessionID, messageID },
    });
    const textEvent = JSON.stringify({
      type: 'text',
      sessionID,
      part: {
        type: 'text',
        sessionID,
        messageID,
        text: answer,
        time: { end: 1 },
      },
    });
    const finishEvent = JSON.stringify({
      type: 'step_finish',
      sessionID,
      part: { type: 'step-finish', sessionID, messageID, reason: 'stop' },
    });
    const script = `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const c=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);if(process.cwd()!==require('node:fs').realpathSync(${JSON.stringify(cwd)})||!input.includes('known fixture context')||process.argv.at(-1)!==${JSON.stringify(agent)}||c.agent[${JSON.stringify(agent)}]?.mode!=='primary'||c.agent[${JSON.stringify(agent)}]?.permission['*']!=='deny')process.exit(9);console.log(${JSON.stringify(startEvent)});console.log(${JSON.stringify(textEvent)});console.log(${JSON.stringify(finishEvent)});process.exit(0);});`;
    const result = await runCommand({
      command: {
        executable: process.execPath,
        args: ['-e', script, ...adapter.invocation.args],
      },
      env: { ...process.env, ...adapter.invocationEnv },
      input: 'known fixture context',
      cwd,
    });
    expect(result.exitCode).toBe(0);
    expect(
      extractOpenCodeResult(result.stdout, result.outputTruncated),
    ).toEqual({ text: answer, status: 'ok' });
  });

  test('Claude JSON extraction rejects truncation, malformed, error, and empty results', () => {
    expect(extractClaudeResult('{"subtype":"success","result":"ok"}')).toEqual({
      text: 'ok',
      status: 'ok',
    });
    expect(
      extractClaudeResult('{"subtype":"success","result":"ok"}', true).status,
    ).toBe('truncated');
    expect(extractClaudeResult('not-json').status).toBe('invalid-json');
    expect(
      extractClaudeResult(
        '{"subtype":"error","is_error":true,"result":"partial"}',
      ).status,
    ).toBe('error-result');
    expect(
      extractClaudeResult('{"subtype":"success","result":""}').status,
    ).toBe('no-final-result');
    for (const primitive of ['null', '[]', '1', '"text"', '{}'])
      expect(extractClaudeResult(primitive).status).toBe('invalid-envelope');
  });

  test('parses OpenCode 1.18 JSONL only when the last completed step has matching text', () => {
    const stream = [
      {
        type: 'step_start',
        sessionID: 's',
        part: { type: 'step-start', sessionID: 's', messageID: 'm1' },
      },
      {
        type: 'text',
        sessionID: 's',
        part: {
          type: 'text',
          sessionID: 's',
          messageID: 'm1',
          text: 'earlier',
          time: { end: 1 },
        },
      },
      {
        type: 'step_finish',
        sessionID: 's',
        part: {
          type: 'step-finish',
          sessionID: 's',
          messageID: 'm1',
          reason: 'tool-calls',
        },
      },
      {
        type: 'step_start',
        sessionID: 's',
        part: { type: 'step-start', sessionID: 's', messageID: 'm2' },
      },
      {
        type: 'text',
        sessionID: 's',
        part: {
          type: 'text',
          sessionID: 's',
          messageID: 'm2',
          text: '{"claims":[]}',
          time: { end: 2 },
        },
      },
      {
        type: 'step_finish',
        sessionID: 's',
        part: {
          type: 'step-finish',
          sessionID: 's',
          messageID: 'm2',
          reason: 'stop',
        },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    expect(extractOpenCodeResult(stream)).toEqual({
      text: '{"claims":[]}',
      status: 'ok',
    });
    expect(extractOpenCodeResult(stream, true).status).toBe('truncated');
    expect(
      extractOpenCodeResult(
        `${stream}\n${JSON.stringify({ type: 'step_start', sessionID: 's', part: { type: 'step-start', sessionID: 's', messageID: 'm3' } })}`,
      ).status,
    ).toBe('unfinished-final-step');
    expect(
      extractOpenCodeResult(
        `${stream}\n${JSON.stringify({ type: 'text', sessionID: 's', part: { type: 'text', sessionID: 'other', messageID: 'm2', text: 'wrong-session', time: { end: 3 } } })}`,
      ).status,
    ).toBe('nested-session-mismatch');
    expect(extractOpenCodeResult('null').status).toBe('invalid-event-envelope');
    expect(extractOpenCodeResult('[]').status).toBe('invalid-event-envelope');
    expect(extractOpenCodeResult('"primitive"').status).toBe(
      'invalid-event-envelope',
    );
    expect(
      extractOpenCodeResult(
        `${stream}\n${JSON.stringify({ type: 'error', sessionID: 's' })}`,
      ).status,
    ).toBe('error-event');
    expect(
      extractOpenCodeResult(
        `${stream}\n${JSON.stringify({ type: 'text', sessionID: 'other', part: {} })}`,
      ).status,
    ).toBe('mixed-or-missing-session');
  });

  test('extracts only final assistant text from Pi JSONL and rejects malformed, intermediate-only, or truncated output', () => {
    const assistant = (text: string) =>
      JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      });
    const stream = [
      JSON.stringify({ type: 'session', id: 'x' }),
      assistant('ignore the first turn'),
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', name: 'read' }],
        },
      }),
      JSON.stringify({ type: 'tool_execution_end', result: {} }),
      assistant('{"claims":[]}'),
    ].join('\n');
    expect(extractPiAssistantText(stream)).toEqual({
      text: '{"claims":[]}',
      status: 'ok',
    });
    expect(extractPiAssistantText(`${assistant('partial')}`, true).status).toBe(
      'truncated',
    );
    expect(extractPiAssistantText('not-json').status).toBe('invalid-jsonl');
    expect(
      extractPiAssistantText(
        JSON.stringify({ type: 'error', message: 'no answer' }),
      ).status,
    ).toBe('no-final-assistant-text');
    expect(
      extractPiAssistantText(
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', name: 'bash' }],
          },
        }),
      ).status,
    ).toBe('no-final-assistant-text');
  });

  for (const id of [
    'modeling-read-only',
    'react-inventory',
    'debugging-read-only',
  ] as CaseId[]) {
    test(`${id} calibrates grounded evidence and rejects malformed/unsupported evidence`, async () => {
      const context = await buildCaseInput(id);
      const texts = Object.fromEntries(
        context.fixtureFiles.map((file) => [file.path, file.text]),
      );
      const source = context.fixtureFiles[0]!;
      const good = JSON.stringify({
        claims: [
          {
            proposition: 'Observed source behavior.',
            evidence: [{ file: source.path, quote: source.text.slice(0, 30) }],
          },
        ],
      });
      expect(
        gradeCaseEvidence(id, good, texts).find(
          ({ id: criterion }) => criterion === 'structured-evidence-links',
        )?.status,
      ).toBe('passed');
      const shortQuote = gradeCaseEvidence(
        id,
        JSON.stringify({
          claims: [
            {
              proposition: 'Observed.',
              evidence: [{ file: source.path, quote: 'abc' }],
            },
          ],
        }),
        texts,
      );
      expect(
        shortQuote.find(
          ({ id: criterion }) => criterion === 'evidence-quote-length',
        )?.status,
      ).toBe('failed');
      expect(
        shortQuote.find(
          ({ id: criterion }) => criterion === 'evidence-quote-membership',
        )?.status,
      ).toBe('passed');
      const extraKey = gradeCaseEvidence(
        id,
        JSON.stringify({
          claims: [
            {
              proposition: 'Observed.',
              evidence: [
                {
                  file: source.path,
                  quote: source.text.slice(0, 8),
                  path: source.path,
                },
              ],
            },
          ],
        }),
        texts,
      );
      expect(
        extraKey.find(
          ({ id: criterion }) => criterion === 'evidence-json-schema',
        )?.status,
      ).toBe('failed');
      const alteredQuote = gradeCaseEvidence(
        id,
        JSON.stringify({
          claims: [
            {
              proposition: 'Observed.',
              evidence: [
                { file: source.path, quote: `${source.text.slice(0, 7)}X` },
              ],
            },
          ],
        }),
        texts,
      );
      expect(
        alteredQuote.find(
          ({ id: criterion }) => criterion === 'evidence-quote-membership',
        )?.status,
      ).toBe('failed');
      const bad = JSON.stringify({
        claims: [
          {
            proposition: 'Unsupported.',
            evidence: [{ file: '../grader.test.ts', quote: 'invented quote' }],
          },
        ],
      });
      expect(
        gradeCaseEvidence(id, bad, texts).find(
          ({ id: criterion }) => criterion === 'structured-evidence-links',
        )?.status,
      ).toBe('failed');
      expect(
        gradeCaseEvidence(id, 'exit 0').find(
          ({ id: criterion }) => criterion === 'structured-evidence-links',
        )?.status,
      ).toBe('failed');
    });
  }

  test('implementation cases refuse execution without operator authorization and verified containment', async () => {
    for (const id of [
      'onboarding-implementation',
      'react-conversion',
    ] as CaseId[]) {
      await expect(
        evaluateCase(id, {
          output: join(root, `${id}-out`),
          runner: 'command',
          command: { executable: fakePi, args: [] },
        }),
      ).rejects.toThrow('explicit operator approval or verified containment');
    }
  });
});

describe('evaluation CLI harness', () => {
  test('registered modeling execution grades its registered task through Pi JSONL while the legacy API remains available', async () => {
    const claims = JSON.stringify({
      claims: [
        {
          proposition: 'The queue exposes its observed list.',
          evidence: [{ file: 'src/Queue.tsx', quote: 'Support queue' }],
        },
      ],
    });
    const assistantEvent = JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        model: 'fake-model-v2',
        provider: 'fake-provider',
        content: [{ type: 'text', text: claims }],
      },
    });
    await fake(
      `if (process.argv.includes('--version')) { console.log('fake-pi 2.0'); process.exit(0); } process.stdin.resume(); process.stdin.on('end', () => { console.log(JSON.stringify({ type: 'session', id: 'session-1' })); console.log(${JSON.stringify(assistantEvent)}); });`,
    );
    const result = await evaluateCase('modeling-read-only', options());
    expect(
      result.criteria.find(({ id }) => id === 'structured-evidence-links')
        ?.status,
    ).toBe('passed');
    expect(result.manifest.runner).toMatchObject({
      version: 'fake-pi 2.0',
      model: 'fake-model-v2',
      provider: 'fake-provider',
    });
    expect((result.manifest.task as { text: string }).text).toContain(
      'Evidence output contract (exact JSON schema; no extra keys)',
    );
  });
  test('Claude adapter passes stdin and explicit no-tools argv, parses terminal JSON, and leaves unreported identity unknown', async () => {
    const finalText = JSON.stringify({ claims: [] });
    await fake(`
if (process.argv.includes('--version')) { console.log('Claude Code 2.0-test'); process.exit(0); }
if (!process.argv.includes('--output-format') || !process.argv.includes('json') || !process.argv.includes('--tools')) process.exit(7);
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', x => input += x);
process.stdin.on('end', () => {
 if (!input.includes('Support queue') || !process.cwd().endsWith('/case')) process.exit(8);
 console.log(JSON.stringify({ subtype: 'success', is_error: false, result: ${JSON.stringify(finalText)}, session_id: 'session-test' }));
});`);
    const result = await evaluateCase('modeling-read-only', {
      output: join(root, 'claude-output'),
      runner: 'claude',
    });
    expect(
      result.criteria.find(({ id }) => id === 'assistant-final-text')?.status,
    ).toBe('passed');
    expect(result.manifest.runner).toMatchObject({
      version: 'Claude Code 2.0-test',
      model: 'unknown',
      provider: 'unknown',
      sessionId: 'session-test',
      tools: { requested: 'disabled' },
    });
    expect(result.manifest.transport).toMatchObject({
      parser: 'claude-print-json-result',
      status: 'ok',
    });
  });

  test('Claude adapter rejects error envelopes even when the process exits zero', async () => {
    await fake(
      `if (process.argv.includes('--version')) { process.exit(0); } console.log(JSON.stringify({ subtype: 'error', is_error: true, result: 'partial answer' }));`,
    );
    const result = await evaluateCase('modeling-read-only', {
      output: join(root, 'claude-error-output'),
      runner: 'claude',
    });
    expect(
      result.criteria.find(({ id }) => id === 'assistant-final-text')?.status,
    ).toBe('failed');
    expect(result.manifest.transport).toMatchObject({ status: 'error-result' });
  });

  test('delivers task on stdin in scratch cwd and separates objective checks from semantic review', async () => {
    await fake(`
if (process.argv.includes('--version')) { console.log('fake-pi 1.2.3'); process.exit(0); }
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  if (!input.includes('Evaluation task:') || !input.includes('Inventory the support-queue') || !input.includes('Case context file: src/Queue.tsx') || !input.includes('Support queue')) process.exit(9);
  if (!process.cwd().endsWith('/case')) process.exit(8);
  console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', model: 'fixture-model', provider: 'fixture-provider', content: [{ type: 'text', text: 'legacy final answer' }] } }));
});`);
    const result = await evaluateModeling(options());
    expect(result.exitCode).toBe(0);
    expect(result.changes).toEqual([]);
    expect(result.criteria.map((criterion) => criterion.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'unrun',
      'unrun',
      'unrun',
    ]);
    expect(result.manifest).toMatchObject({
      runner: {
        version: 'fake-pi 1.2.3',
        model: 'fixture-model',
        provider: 'fixture-provider',
      },
      security: { filesystemSandbox: false, environmentSerialized: false },
    });
    expect(JSON.stringify(result.manifest)).not.toContain(
      process.env.OPENAI_API_KEY ?? 'not-present-secret',
    );
    expect(
      await readFile(
        join(
          result.manifest.security.privateOutputDirectory as string,
          'stdout.jsonl',
        ),
        'utf8',
      ),
    ).toContain('fixture-model');
  });

  test('rejects output paths that reach the checkout through a symlink before mkdir', async () => {
    const workspace = join(import.meta.dir, '../../../../');
    const alias = join(root, 'checkout-alias');
    const destination = join(
      alias,
      `.evaluation-output-test-${process.pid}-${Date.now()}`,
    );
    await symlink(workspace, alias);
    await expect(
      evaluateModeling({ output: destination, runner: 'pi' }),
    ).rejects.toThrow('outside the workspace checkout');
    await expect(stat(destination)).rejects.toThrow();
  });

  test('rejects checkout output paths before creating them', async () => {
    const checkoutPath = join(
      import.meta.dir,
      '../../../../.evaluation-output-must-not-exist',
    );
    await expect(
      evaluateModeling({ output: checkoutPath, runner: 'pi' }),
    ).rejects.toThrow('outside the workspace checkout');
    await expect(stat(checkoutPath)).rejects.toThrow();
  });

  test('registered evaluateCase always fails read-only mutations and fixture inspection errors', async () => {
    await fake(`
const fs = await import('node:fs');
process.stdin.resume();
process.stdin.on('end', () => {
  fs.writeFileSync('report.md', 'mutated');
  console.log('diagnostic answer');
});`);
    const changed = await evaluateCase('debugging-read-only', {
      ...genericOptions(),
      output: join(root, 'registered-mutation'),
    });
    expect(
      changed.criteria.find(({ id }) => id === 'read-only-zero-changes')
        ?.status,
    ).toBe('failed');

    const outside = join(root, 'outside-fixture-root');
    await (await import('node:fs/promises')).mkdir(outside, {
      recursive: true,
    });
    await fake(`
const fs = await import('node:fs');
const cwd = process.cwd();
process.stdin.resume();
process.stdin.on('end', () => {
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.symlinkSync(${JSON.stringify(outside)}, cwd);
  console.log('diagnostic answer');
});`);
    const unreadable = await evaluateCase('debugging-read-only', {
      ...genericOptions(),
      output: join(root, 'registered-inspection-error'),
    });
    expect(unreadable.inspectionError).toContain(
      'root was removed or replaced',
    );
    expect(
      unreadable.criteria.find(({ id }) => id === 'read-only-zero-changes')
        ?.status,
    ).toBe('failed');
  });

  test('captures fixture additions and edits as objective failures', async () => {
    await fake(`
if (process.argv.includes('--version')) { console.log('fake 1'); process.exit(0); }
const fs = await import('node:fs'); fs.writeFileSync('added.txt', 'new'); fs.writeFileSync('src/Queue.tsx', 'changed'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`);
    const result = await evaluateModeling(options());
    expect(result.changes.map(({ kind }) => kind).sort()).toEqual([
      'added',
      'modified',
    ]);
    expect(
      result.criteria.find(({ id }) => id === 'read-only-zero-changes')?.status,
    ).toBe('failed');
  });

  test('publishes bounded private grader process and browser evidence', () => {
    const evidence = candidateGraderEvidence({
      caseId: 'onboarding-implementation',
      harnessStatus: 'ready',
      criteria: [],
      commands: [
        {
          command: ['node', 'browser-case.mjs'],
          status: 'completed',
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          durationMs: 321,
          summary: `${'x'.repeat(2500)}\\nBrowser geometry and SDK registration observed`,
          outputTruncated: true,
        },
      ],
      changedPaths: [],
      evidence: [],
    });
    expect(evidence.commands[0]?.processEvidence).toHaveLength(2000);
    expect(evidence.commands[0]?.processEvidence).toContain(
      'Browser geometry and SDK registration observed',
    );
    expect(evidence.commands[0]?.outputTruncated).toBe(true);
    expect(evidence.commands[0]).toMatchObject({
      argv: ['node', 'browser-case.mjs'],
      status: 'completed',
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      durationMs: 321,
    });
  });

  test('permits generated artifact deletion, but rejects protected and dependency deletions', async () => {
    for (const path of [
      '.vite/deps/_metadata.json',
      'node_modules/.vite/deps/chunk.js',
      'dist/assets/app-oldhash.js',
      'coverage/summary.json',
      'test-results/report.json',
      'playwright-report/index.html',
    ]) {
      expect(isDisposableArtifactChange({ path, kind: 'added' })).toBe(true);
      expect(isDisposableArtifactChange({ path, kind: 'modified' })).toBe(true);
      expect(isDisposableArtifactChange({ path, kind: 'deleted' })).toBe(true);
    }
    for (const path of [
      'src/App.tsx',
      'package.json',
      'vite.config.ts',
      'node_modules/@maelstrom-co/react/dist/index.js',
      'coverage-evil/file.js',
    ]) {
      expect(isDisposableArtifactChange({ path, kind: 'added' })).toBe(false);
      expect(isDisposableArtifactChange({ path, kind: 'deleted' })).toBe(false);
    }

    const candidateRoot = join(root, 'deleted-protected-candidate');
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(candidateRoot, 'src'), { recursive: true });
    await fs.mkdir(join(candidateRoot, 'node_modules/@maelstrom-co/react'), {
      recursive: true,
    });
    await writeFile(join(candidateRoot, 'package.json'), '{}\\n');
    await writeFile(join(candidateRoot, 'src/App.tsx'), 'export {};\\n');
    const dependency = join(
      candidateRoot,
      'node_modules/@maelstrom-co/react/index.js',
    );
    await writeFile(dependency, 'export {};\\n');

    let baseline = await snapshotCandidate(candidateRoot);
    await rm(join(candidateRoot, 'package.json'));
    let grade = await gradeCandidate('onboarding-implementation', {
      candidateRoot,
      baseline,
    });
    expect(grade.harnessStatus).toBe('blocked');
    expect(
      grade.criteria.find(({ id }) => id === 'trusted-file-integrity')?.status,
    ).toBe('failed');
    expect(
      grade.criteria.find(({ id }) => id === 'application-change-allowlist')
        ?.status,
    ).toBe('failed');
    expect(grade.commands).toHaveLength(0);

    await writeFile(join(candidateRoot, 'package.json'), '{}\\n');
    baseline = await snapshotCandidate(candidateRoot);
    await rm(dependency);
    grade = await gradeCandidate('onboarding-implementation', {
      candidateRoot,
      baseline,
    });
    expect(grade.harnessStatus).toBe('blocked');
    expect(
      grade.criteria.find(({ id }) => id === 'application-change-allowlist')
        ?.status,
    ).toBe('failed');
    expect(grade.commands).toHaveLength(0);

    const artifactRoot = join(candidateRoot, 'dist/assets');
    await fs.mkdir(artifactRoot, { recursive: true });
    await writeFile(join(artifactRoot, 'actual.js'), 'generated');
    const generatedSymlink = join(artifactRoot, 'linked.js');
    await symlink('actual.js', generatedSymlink);
    baseline = await snapshotCandidate(candidateRoot);
    await rm(generatedSymlink);
    grade = await gradeCandidate('onboarding-implementation', {
      candidateRoot,
      baseline,
    });
    expect(
      grade.criteria.find(({ id }) => id === 'application-change-allowlist')
        ?.status,
    ).toBe('failed');
    expect(grade.commands).toHaveLength(0);
  });

  test('generated artifact roots stay narrow across additions, modifications and deletions', () => {
    for (const path of [
      '.vite/deps/_metadata.json',
      'node_modules/.vite/deps/chunk.js',
      'dist/assets/app.js',
      'coverage/summary.json',
      'test-results/report.json',
      'playwright-report/index.html',
    ]) {
      expect(isDisposableArtifactChange({ path, kind: 'added' })).toBe(true);
      expect(isDisposableArtifactChange({ path, kind: 'modified' })).toBe(true);
      expect(isDisposableArtifactChange({ path, kind: 'deleted' })).toBe(true);
    }
    for (const path of [
      'src/App.tsx',
      'package.json',
      'vite.config.ts',
      'node_modules/@maelstrom-co/react/dist/index.js',
      'coverage-evil/file.js',
    ])
      expect(isDisposableArtifactChange({ path, kind: 'added' })).toBe(false);
  });

  test('diff classifies additions, modifications and deletions', () => {
    const result = diff(
      new Map([
        ['edit', 'old'],
        ['remove', 'gone'],
      ]),
      new Map([
        ['edit', 'new'],
        ['add', 'new'],
      ]),
    );
    expect(result.map(({ kind }) => kind).sort()).toEqual([
      'added',
      'deleted',
      'modified',
    ]);
  });

  test('runs a generic CLI with literal argv, exact stdin and explicit cwd', async () => {
    const marker = join(root, 'should-not-exist');
    const argument = `two words; touch ${marker}`;
    const cwd = join(root, 'generic-cwd');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(cwd));
    const code = `let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', value => input += value); process.stdin.on('end', () => { if (!process.argv.includes(${JSON.stringify(argument)} ) || input !== 'exact prompt\\n' || process.cwd() !== require('node:fs').realpathSync(${JSON.stringify(cwd)})) process.exit(3); console.log('generic-ok'); });`;
    const result = await runCommand({
      command: { executable: 'node', args: ['-e', code, argument] },
      input: 'exact prompt\n',
      cwd,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('generic-ok');
    await expect(stat(marker)).rejects.toThrow();
  });

  test('generic command adapter preserves its single invocation and does not invent a version probe', async () => {
    const calls = join(root, 'generic-calls.txt');
    await fake(
      `const fs = await import('node:fs'); fs.appendFileSync(${JSON.stringify(calls)}, 'call\\n'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`,
    );
    const result = await evaluateModeling(genericOptions());
    expect(result.exitCode).toBe(0);
    expect(await readFile(calls, 'utf8')).toBe('call\n');
  });

  test('generic tool-use evidence does not claim the CLI disabled tools', async () => {
    await fake(
      `process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`,
    );
    const result = await evaluateModeling(genericOptions());
    const criterion = result.criteria.find(
      ({ id }) => id === 'tool-use-and-repository-inspection',
    );
    expect(criterion?.status).toBe('unrun');
    expect(criterion?.evidence).toContain(
      'tool policy and tool use were not evaluated',
    );
    expect(criterion?.evidence).not.toContain('Tools were disabled');
  });

  test('legacy read-only API rejects managed tool opt-in and conflicting aliases before setup', async () => {
    const marker = join(root, 'unexpected-managed-spawn');
    const oldOpenCode = process.env.OPENCODE_CLI;
    const oldTmpdir = process.env.TMPDIR;
    process.env.OPENCODE_CLI = fakePi;
    process.env.TMPDIR = root;
    await fake(
      `(await import('node:fs')).writeFileSync(${JSON.stringify(marker)}, 'started');`,
    );
    const before = await readdir(root);
    try {
      const invalid = [
        { runner: 'pi' as const, toolAccess: 'enabled' as const },
        { runner: 'claude' as const, toolAccess: 'enabled' as const },
        { runner: 'opencode' as const, toolAccess: 'enabled' as const },
        {
          runner: 'pi' as const,
          toolAccess: 'disabled' as const,
          piToolAccess: 'enabled' as const,
        },
        { runner: 'claude' as const, piToolAccess: 'disabled' as const },
      ];
      for (const [index, options] of invalid.entries())
        await expect(
          evaluateModeling({
            output: join(root, `legacy-readonly-${index}`),
            ...options,
          }),
        ).rejects.toThrow(/read-only|Conflicting|Pi-only/);
      expect(await readdir(root)).toEqual(before);
      await expect(stat(marker)).rejects.toThrow();
    } finally {
      if (oldOpenCode === undefined) delete process.env.OPENCODE_CLI;
      else process.env.OPENCODE_CLI = oldOpenCode;
      if (oldTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = oldTmpdir;
    }
  });

  test('CLI parser preserves reserved-looking literal --arg values', async () => {
    await fake(
      `console.log(JSON.stringify({ claims: [{ proposition: 'Queue observation.', evidence: [{ file: 'src/Queue.tsx', quote: 'Support queue' }] }] })); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`,
    );
    const cwd = root;
    const literalArgs = ['--runner', '--output', '--command', '--help'];
    const cliArgs = [
      join(import.meta.dir, 'index.ts'),
      '--arg',
      '--runner',
      '--arg',
      '--output',
      '--arg',
      '--command',
      '--arg',
      '--help',
      '--case',
      'modeling-read-only',
      '--runner',
      'command',
      '--output',
      join(root, 'cli-private-output'),
      '--command',
      fakePi,
    ];
    const result = await runCommand({
      command: { executable: process.execPath, args: cliArgs },
      input: '',
      cwd,
      timeoutMs: 10_000,
    });
    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(result.stdout) as {
      manifest: { runner: { command: string[] } };
    };
    expect(summary.manifest.runner.command).toEqual([fakePi, ...literalArgs]);
  });

  test('CLI rejects implementation candidates that do not match trusted prepared sources', async () => {
    const candidateRoot = join(root, 'authorized-candidate');
    await mkdir(join(candidateRoot, 'src'), { recursive: true });
    await writeFile(
      join(candidateRoot, 'package.json'),
      JSON.stringify({ name: 'authorized-candidate', version: '0.0.0' }),
    );
    await fake(`
if (!process.argv.includes('literal command argument')) process.exit(9);
const fs = await import('node:fs');
fs.writeFileSync('src/Feature.tsx', 'export const Feature = () => <section>Authorized</section>;\\n');
process.stdin.resume(); process.stdin.on('end', () => { console.log('generic implementation complete'); process.exit(0); });`);
    const result = await runCommand({
      command: {
        executable: process.execPath,
        args: [
          join(import.meta.dir, 'index.ts'),
          '--case',
          'onboarding-implementation',
          '--runner',
          'command',
          '--candidate-root',
          candidateRoot,
          '--authorize-coding',
          'operator-approved',
          '--output',
          join(root, 'authorized-command-output'),
          '--command',
          fakePi,
          '--arg',
          'literal command argument',
        ],
      },
      input: '',
      cwd: root,
      timeoutMs: 10_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Prepared trial');
    await expect(
      readFile(join(candidateRoot, 'src/Feature.tsx'), 'utf8'),
    ).rejects.toThrow();
  });

  test('CLI tool flags reject conflicting values and the Pi-only alias on other runners before setup', async () => {
    for (const flags of [
      ['--tools', 'enabled', '--pi-tools', 'disabled'],
      ['--pi-tools', 'disabled'],
    ]) {
      const output = join(
        root,
        `invalid-tools-${flags.length}-${flags.at(-1)}`,
      );
      const result = await runCommand({
        command: {
          executable: process.execPath,
          args: [
            join(import.meta.dir, 'index.ts'),
            '--case',
            'modeling-read-only',
            '--runner',
            'claude',
            '--output',
            output,
            ...flags,
          ],
        },
        input: '',
        cwd: root,
        timeoutMs: 10_000,
      });
      expect(result.exitCode).toBe(2);
      await expect(stat(output)).rejects.toThrow();
    }
  });

  test('invalid generic configuration allocates no scratch or output directory', async () => {
    const previousTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = root;
    const before = await readdir(root);
    try {
      await expect(
        evaluateModeling({
          output: join(root, 'invalid-output'),
          runner: 'command',
        }),
      ).rejects.toThrow('Generic command runner requires an executable');
      expect(await readdir(root)).toEqual(before);
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
    }
  });

  test('managed adapters fail transport and acceptance when inherited pipes prevent complete capture', async () => {
    if (process.platform === 'win32') return;
    const oldOpenCode = process.env.OPENCODE_CLI;
    process.env.OPENCODE_CLI = fakePi;
    const previousPidPath = process.env.EVALUATION_ORPHAN_PID;
    const orphanCode = `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
    try {
      for (const runner of ['claude', 'opencode'] as const) {
        const pidPath = join(root, `${runner}-orphan.pid`);
        process.env.EVALUATION_ORPHAN_PID = pidPath;
        const claude = runner === 'claude';
        const finalOutput = claude
          ? `console.log(JSON.stringify({ subtype: 'success', is_error: false, result: 'complete-looking answer', session_id: 's' }));`
          : `const sessionID = 's'; const messageID = 'm'; console.log(JSON.stringify({ type: 'step_start', sessionID, part: { type: 'step-start', sessionID, messageID } })); console.log(JSON.stringify({ type: 'text', sessionID, part: { type: 'text', sessionID, messageID, text: 'complete-looking answer', time: { end: 1 } } })); console.log(JSON.stringify({ type: 'step_finish', sessionID, part: { type: 'step-finish', sessionID, messageID, reason: 'stop' } }));`;
        await fake(`
if (process.argv.includes('--version')) { console.log('fake-version'); process.exit(0); }
const fs = await import('node:fs'); const { spawn } = await import('node:child_process');
const orphan = spawn(process.execPath, ['-e', ${JSON.stringify(orphanCode)}], { detached: true, stdio: ['ignore', process.stdout, process.stderr] });
orphan.unref(); fs.writeFileSync(process.env.EVALUATION_ORPHAN_PID, String(orphan.pid));
process.stdin.resume(); process.stdin.on('end', () => { ${finalOutput} process.exit(0); });`);
        let orphanPid: number | undefined;
        try {
          const result = await evaluateCase('modeling-read-only', {
            output: join(root, `${runner}-incomplete-output`),
            runner,
            timeoutMs: 5_000,
          });
          orphanPid = Number(await readFile(pidPath, 'utf8'));
          expect(result.exitCode).toBe(0);
          expect(result.captureIncomplete).toBe(true);
          expect(result.manifest.transport).toMatchObject({
            status: 'capture-incomplete',
          });
          expect(
            result.criteria.find(({ id }) => id === 'process-success')?.status,
          ).toBe('failed');
          expect(
            result.criteria.find(({ id }) => id === 'assistant-final-text')
              ?.status,
          ).toBe('failed');
          expect(result.manifest.process).toMatchObject({
            captureIncomplete: true,
          });
          expect(result.stdout).toContain('complete-looking answer');
        } finally {
          if (!orphanPid) {
            try {
              orphanPid = Number(await readFile(pidPath, 'utf8'));
            } catch {}
          }
          if (orphanPid && isProcessAlive(orphanPid)) {
            try {
              process.kill(orphanPid, 'SIGKILL');
            } catch {}
            for (
              let attempt = 0;
              attempt < 50 && isProcessAlive(orphanPid);
              attempt++
            )
              await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
          }
        }
      }
    } finally {
      if (previousPidPath === undefined)
        delete process.env.EVALUATION_ORPHAN_PID;
      else process.env.EVALUATION_ORPHAN_PID = previousPidPath;
      if (oldOpenCode === undefined) delete process.env.OPENCODE_CLI;
      else process.env.OPENCODE_CLI = oldOpenCode;
    }
  });

  test('production adapters publish failure artifacts for JSON null and primitive envelopes', async () => {
    const oldOpenCode = process.env.OPENCODE_CLI;
    process.env.OPENCODE_CLI = fakePi;
    try {
      for (const runner of ['claude', 'opencode'] as const) {
        await fake(
          `if (process.argv.includes('--version')) { console.log('fake-version'); process.exit(0); } process.stdin.resume(); process.stdin.on('end', () => { console.log('null'); process.exit(0); });`,
        );
        const result = await evaluateCase('modeling-read-only', {
          output: join(root, `${runner}-null-output`),
          runner,
        });
        expect(result.exitCode).toBe(0);
        expect(result.manifest.transport).toMatchObject({
          status:
            runner === 'claude' ? 'invalid-envelope' : 'invalid-event-envelope',
        });
        expect(
          result.criteria.find(({ id }) => id === 'assistant-final-text')
            ?.status,
        ).toBe('failed');
        const artifactDirectory = (
          result.manifest.security as { privateOutputDirectory: string }
        ).privateOutputDirectory;
        const savedManifest = JSON.parse(
          await readFile(join(artifactDirectory, 'manifest.json'), 'utf8'),
        ) as {
          transport: { status: string };
        };
        expect(savedManifest.transport.status).toBe(
          runner === 'claude' ? 'invalid-envelope' : 'invalid-event-envelope',
        );
        expect(
          await readFile(join(artifactDirectory, 'stdout.jsonl'), 'utf8'),
        ).toContain('null');
      }
    } finally {
      if (oldOpenCode === undefined) delete process.env.OPENCODE_CLI;
      else process.env.OPENCODE_CLI = oldOpenCode;
    }
  });

  test('bounds capture when a detached orphan keeps inherited pipes open', async () => {
    if (process.platform === 'win32') return;
    const pidPath = join(root, 'orphan-pipe.pid');
    const previousPidPath = process.env.EVALUATION_ORPHAN_PID;
    process.env.EVALUATION_ORPHAN_PID = pidPath;
    const orphanCode = `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
    await fake(`
const fs = await import('node:fs');
const { spawn } = await import('node:child_process');
const child = spawn(process.execPath, ['-e', ${JSON.stringify(orphanCode)}], { detached: true, stdio: ['ignore', process.stdout, process.stderr] });
child.unref();
fs.writeFileSync(process.env.EVALUATION_ORPHAN_PID, String(child.pid));
process.stdin.resume();
process.stdin.on('end', () => { console.log('parent-exiting'); process.exit(0); });`);
    let orphanPid: number | undefined;
    try {
      const result = await evaluateModeling(genericOptions());
      orphanPid = Number(await readFile(pidPath, 'utf8'));
      expect(result.exitCode).toBe(0);
      expect(result.captureIncomplete).toBe(true);
      expect(result.manifest.process).toMatchObject({
        captureIncomplete: true,
      });
      expect(result.stdout).toContain('parent-exiting');
      expect(result.durationMs).toBeLessThan(4_000);
      expect(isProcessAlive(orphanPid)).toBe(true);
    } finally {
      if (!orphanPid) {
        try {
          orphanPid = Number(await readFile(pidPath, 'utf8'));
        } catch {}
      }
      if (orphanPid && isProcessAlive(orphanPid)) {
        try {
          process.kill(orphanPid, 'SIGKILL');
        } catch {}
      }
      if (previousPidPath === undefined)
        delete process.env.EVALUATION_ORPHAN_PID;
      else process.env.EVALUATION_ORPHAN_PID = previousPidPath;
    }
  });

  test('reports nonzero exit and preserves stdout/stderr', async () => {
    await fake(`
if (process.argv.includes('--version')) { console.log('fake'); process.exit(0); }
console.log('captured stdout'); console.error('captured stderr'); process.exit(7);`);
    const result = await evaluateModeling(options());
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toContain('captured stdout');
    expect(result.stderr).toContain('captured stderr');
    expect(result.criteria[0]?.status).toBe('failed');
  });

  test('reports spawn failure without semantic grading', async () => {
    process.env.PI_CLI = join(root, 'missing-executable');
    const result = await evaluateModeling(options());
    expect(result.status).toBe('spawn-error');
    expect(result.spawnError).toBeDefined();
    expect(
      result.criteria.find(({ id }) => id === 'semantic-quality')?.status,
    ).toBe('unrun');
  });

  test('bounds Pi version discovery and terminates the hanging version process', async () => {
    const pidPath = join(root, 'version.pid');
    const previousPidPath = process.env.EVALUATION_VERSION_DISCOVERY_PID;
    process.env.EVALUATION_VERSION_DISCOVERY_PID = pidPath;
    await fake(`
if (process.argv.includes('--version')) {
  (await import('node:fs')).writeFileSync(process.env.EVALUATION_VERSION_DISCOVERY_PID, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  process.stdin.resume();
  process.stdin.on('end', () => { console.log('main completed'); process.exit(0); });
}`);
    try {
      const result = await evaluateModeling({
        ...options(),
        timeoutMs: 10_000,
        versionTimeoutMs: 1_500,
      });
      expect(result.exitCode).toBe(0);
      expect((result.manifest.runner as { version: string }).version).toBe(
        'unknown',
      );
      const pid = Number(await readFile(pidPath, 'utf8'));
      expect(isProcessAlive(pid)).toBe(false);
    } finally {
      if (previousPidPath === undefined)
        delete process.env.EVALUATION_VERSION_DISCOVERY_PID;
      else process.env.EVALUATION_VERSION_DISCOVERY_PID = previousPidPath;
    }
  });

  test('timeout terminates the owned process group and captures timeout status', async () => {
    await fake(
      `if (process.argv.includes('--version')) { console.log('fake'); process.exit(0); } setInterval(() => {}, 1000);`,
    );
    const result = await evaluateModeling({ ...options(), timeoutMs: 30 });
    expect(result.timedOut).toBe(true);
    expect(result.signal).not.toBeNull();
    expect(result.criteria[0]?.status).toBe('failed');
  });

  test('pre-start cancellation and cancellation during preparation never spawn the CLI', async () => {
    const marker = join(root, 'cli-was-started');
    const previousMarker = process.env.EVALUATION_START_MARKER;
    await fake(
      `const fs = await import('node:fs'); fs.writeFileSync(process.env.EVALUATION_START_MARKER, 'started'); process.stdin.resume();`,
    );
    process.env.EVALUATION_START_MARKER = marker;
    try {
      const beforeStart = new AbortController();
      beforeStart.abort();
      await expect(
        evaluateModeling({ ...options(), signal: beforeStart.signal }),
      ).rejects.toThrow('cancelled before process startup');
      const duringPreparation = new AbortController();
      const evaluation = evaluateModeling({
        ...options(),
        signal: duringPreparation.signal,
      });
      duringPreparation.abort();
      await expect(evaluation).rejects.toThrow(
        'cancelled before process startup',
      );
      await expect(stat(marker)).rejects.toThrow();
    } finally {
      if (previousMarker === undefined)
        delete process.env.EVALUATION_START_MARKER;
      else process.env.EVALUATION_START_MARKER = previousMarker;
    }
  });

  test('handles a CLI that closes stdin early without an uncaught stream error', async () => {
    const cwd = join(root, 'epipe-cwd');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(cwd));
    const result = await runCommand({
      command: {
        executable: 'head',
        args: ['-c', '1'],
      },
      input: 'x'.repeat(32 * 1024 * 1024),
      cwd,
      timeoutMs: 1000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('x');
  });

  test('captures output even when fixture root is replaced with an outside symlink', async () => {
    const outside = join(root, 'outside');
    const capture = join(root, 'captured-cwd');
    const previousCapture = process.env.EVALUATION_CAPTURE_CWD;
    const previousOutside = process.env.EVALUATION_OUTSIDE;
    await import('node:fs/promises').then(({ mkdir }) => mkdir(outside));
    await writeFile(join(outside, 'outside.txt'), 'must not be inventoried');
    process.env.EVALUATION_CAPTURE_CWD = capture;
    await fake(`
const fs = await import('node:fs'); process.stdin.resume(); process.stdin.on('end', () => { const cwd = process.cwd(); fs.writeFileSync(process.env.EVALUATION_CAPTURE_CWD, cwd); fs.renameSync(cwd, cwd + '.saved'); fs.symlinkSync(process.env.EVALUATION_OUTSIDE, cwd); console.log('captured-before-inspection-failure'); });`);
    process.env.EVALUATION_OUTSIDE = outside;
    try {
      const result = await evaluateModeling(genericOptions());
      expect(result.inspectionError).toContain('root was removed or replaced');
      expect(
        result.criteria.find(({ id }) => id === 'read-only-zero-changes')
          ?.status,
      ).toBe('failed');
      expect(result.stdout).toContain('captured-before-inspection-failure');
      const cwd = await readFile(capture, 'utf8');
      await expect(stat(cwd)).rejects.toThrow();
    } finally {
      if (previousCapture === undefined)
        delete process.env.EVALUATION_CAPTURE_CWD;
      else process.env.EVALUATION_CAPTURE_CWD = previousCapture;
      if (previousOutside === undefined) delete process.env.EVALUATION_OUTSIDE;
      else process.env.EVALUATION_OUTSIDE = previousOutside;
    }
  });

  test('records nested symlink inspection failure and retains raw process output', async () => {
    const outside = join(root, 'outside-nested');
    const previousOutside = process.env.EVALUATION_OUTSIDE;
    await import('node:fs/promises').then(({ mkdir }) => mkdir(outside));
    await fake(`
const fs = await import('node:fs'); process.stdin.resume(); process.stdin.on('end', () => { fs.symlinkSync(process.env.EVALUATION_OUTSIDE, 'escape'); console.log('nested-link-run'); });`);
    process.env.EVALUATION_OUTSIDE = outside;
    try {
      const result = await evaluateModeling(genericOptions());
      expect(result.inspectionError).toContain('Run created a symlink');
      expect(result.stdout).toContain('nested-link-run');
      const artifacts = result.manifest.security as {
        privateOutputDirectory: string;
      };
      await expect(
        readFile(
          join(artifacts.privateOutputDirectory, 'stdout.jsonl'),
          'utf8',
        ),
      ).resolves.toContain('nested-link-run');
    } finally {
      if (previousOutside === undefined) delete process.env.EVALUATION_OUTSIDE;
      else process.env.EVALUATION_OUTSIDE = previousOutside;
    }
  });

  test('cleans up same-group descendants after direct child exits', async () => {
    if (process.platform === 'win32') return;
    const cwd = join(root, 'descendant-cwd');
    const pidPath = join(root, 'descendant.pid');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(cwd));
    const code = `const { spawn } = require('node:child_process'); const fs = require('node:fs'); const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: 'ignore' }); fs.writeFileSync(process.env.DESCENDANT_PID_FILE, String(child.pid)); process.stdin.resume(); process.stdin.on('end', () => setTimeout(() => process.exit(0), 20));`;
    const result = await runCommand({
      command: { executable: 'node', args: ['-e', code] },
      input: 'go',
      cwd,
      env: { ...process.env, DESCENDANT_PID_FILE: pidPath },
    });
    expect(result.exitCode).toBe(0);
    const pid = Number(await readFile(pidPath, 'utf8'));
    let alive = true;
    for (let attempt = 0; attempt < 30 && alive; attempt++) {
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      if (alive)
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    if (alive) process.kill(pid, 'SIGKILL');
    expect(alive).toBe(false);
  });

  test('preserves multibyte UTF-8 split across stdout chunks', async () => {
    const cwd = join(root, 'utf8-cwd');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(cwd));
    const code = `process.stdout.write(Buffer.from([0xe2])); setTimeout(() => process.stdout.write(Buffer.from([0x82])), 5); setTimeout(() => { process.stdout.write(Buffer.from([0xac])); process.exit(0); }, 10);`;
    const result = await runCommand({
      command: { executable: 'node', args: ['-e', code] },
      input: '',
      cwd,
    });
    expect(result.stdout).toBe('€');
  });

  test('cancellation during Pi version discovery marks the evaluation cancelled and terminates that process', async () => {
    const pidPath = join(root, 'version-cancel.pid');
    const previousPidPath = process.env.EVALUATION_VERSION_CANCEL_PID;
    process.env.EVALUATION_VERSION_CANCEL_PID = pidPath;
    await fake(`
if (process.argv.includes('--version')) {
  (await import('node:fs')).writeFileSync(process.env.EVALUATION_VERSION_CANCEL_PID, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
}`);
    const controller = new AbortController();
    try {
      const evaluation = evaluateModeling({
        ...options(),
        signal: controller.signal,
        versionTimeoutMs: 10_000,
      });
      await waitForFile(pidPath);
      controller.abort();
      const result = await evaluation;
      expect(result.cancelled).toBe(true);
      expect(result.status).toBe('cancelled');
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.manifest.process).toMatchObject({
        exitCode: 0,
        signal: null,
      });
      expect(isProcessAlive(Number(await readFile(pidPath, 'utf8')))).toBe(
        false,
      );
    } finally {
      if (previousPidPath === undefined)
        delete process.env.EVALUATION_VERSION_CANCEL_PID;
      else process.env.EVALUATION_VERSION_CANCEL_PID = previousPidPath;
    }
  });

  test('cancellation terminates the owned child process', async () => {
    await fake(
      `if (process.argv.includes('--version')) { console.log('fake'); process.exit(0); } setInterval(() => {}, 1000);`,
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const result = await evaluateModeling({
      ...options(),
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.signal).not.toBeNull();
  });
});
