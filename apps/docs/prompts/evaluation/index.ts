import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseJsonc } from 'jsonc-parser';
import { parsePromptSource } from '../../tools/prompts/library';
import {
  buildCaseInput,
  type CaseId,
  caseRegistry,
  definitionFor,
  gradeCaseEvidence,
  caseId as isCaseId,
} from './cases';

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceRoot = resolve(docsRoot, '../..');
const fixtureRoot = join(
  docsRoot,
  'prompts/acceptance/fixtures/modeling-react',
);
const outputLimit = 1024 * 1024;
const timeoutMs = 120_000;
const killGraceMs = 250;
const pipeDrainMs = 500;

/** Hashed filesystem evidence for one fixture path. */
export interface FileChange {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
  beforeHash?: string;
  afterHash?: string;
}

/** Executable plus literal argv, invoked without a shell. */
export interface CommandSpec {
  executable: string;
  args: string[];
}

/** Supported invocation adapters for case evaluation. */
export type EvaluationRunner = 'pi' | 'command' | 'opencode' | 'claude';
type ToolAccess = 'disabled' | 'enabled';

/** Captured process streams, status, limits and termination evidence. */
export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: string;
  stdinError?: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  outputTruncated: boolean;
  captureIncomplete: boolean;
}

/** Generic objective evaluation result; semantic criteria remain independent. */
export interface RunResult {
  status: 'completed' | 'spawn-error' | 'cancelled';
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: string;
  stdinError?: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  captureIncomplete: boolean;
  changes: FileChange[];
  inspectionError?: string;
  criteria: {
    id: string;
    status: 'passed' | 'failed' | 'unrun';
    evidence: string;
  }[];
  manifest: Record<string, unknown>;
}

/** Runs an argv-based CLI with exact stdin and a caller-owned cwd, without a shell. */
export async function runCommand(options: {
  command: CommandSpec;
  input: string;
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  outputLimit?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<ProcessResult> {
  const startedAt = Date.now();
  const limit = options.outputLimit ?? outputLimit;
  const stdout = new BoundedCapture(limit);
  const stderr = new BoundedCapture(limit);
  if (options.signal?.aborted) {
    return {
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
      durationMs: Date.now() - startedAt,
      timedOut: false,
      cancelled: true,
      outputTruncated: false,
      captureIncomplete: false,
    };
  }

  let child: ChildProcess;
  try {
    child = spawn(options.command.executable, options.command.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
  } catch (error) {
    return failedSpawn(startedAt, error);
  }

  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let spawnError: string | undefined;
  let stdinError: string | undefined;
  let timedOut = false;
  let cancelled = false;
  let captureIncomplete = false;
  let termination: Promise<void> | undefined;
  let resolveExit!: () => void;
  const exited = new Promise<void>((resolveExitPromise) => {
    resolveExit = resolveExitPromise;
  });
  const terminateOwnedGroup = (): Promise<void> => {
    if (termination) return termination;
    termination = (async () => {
      signalOwned(child, 'SIGTERM');
      await delay(killGraceMs);
      signalOwned(child, 'SIGKILL');
    })();
    return termination;
  };
  const onAbort = () => {
    cancelled = true;
    void terminateOwnedGroup();
  };
  child.stdout?.on('data', (chunk: Buffer) => stdout.add(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderr.add(chunk));
  child.stdin?.on('error', (error: Error) => {
    stdinError = error.message;
    void terminateOwnedGroup();
  });
  child.stdin?.on('close', () => {
    if (!child.stdin?.writableFinished && options.input.length > 0) {
      stdinError ??= 'stdin closed before the full input was written';
    }
  });
  child.on('error', (error) => {
    spawnError = error.message;
  });
  child.once('exit', (code, childSignal) => {
    exitCode = code;
    signal = childSignal;
    resolveExit();
    // Also stop same-group descendants after a normal direct-child exit.
    void terminateOwnedGroup();
  });
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const timeout = setTimeout(() => {
    timedOut = true;
    void terminateOwnedGroup();
  }, options.timeoutMs ?? timeoutMs);
  child.stdin?.end(options.input);

  let closeCompleted = false;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const closed = new Promise<void>((resolveClose) => {
    child.once('close', (code, childSignal) => {
      if (exitCode === null) exitCode = code;
      if (signal === null) signal = childSignal;
      closeCompleted = true;
      resolveClose();
    });
  });
  await Promise.race([
    closed,
    (async () => {
      await exited;
      if (termination) await termination;
      if (closeCompleted) return;
      await new Promise<void>((resolveDrain) => {
        drainTimer = setTimeout(resolveDrain, pipeDrainMs);
      });
      if (closeCompleted) return;
      captureIncomplete = true;
      child.stdout?.destroy();
      child.stderr?.destroy();
    })(),
  ]);
  if (drainTimer) clearTimeout(drainTimer);
  clearTimeout(timeout);
  if (termination) await termination;
  options.signal?.removeEventListener('abort', onAbort);
  return {
    stdout: stdout.text(),
    stderr: stderr.text(),
    exitCode,
    signal,
    ...(spawnError ? { spawnError } : {}),
    ...(stdinError ? { stdinError } : {}),
    durationMs: Date.now() - startedAt,
    timedOut,
    cancelled,
    outputTruncated: stdout.truncated || stderr.truncated,
    captureIncomplete,
  };
}

/** Runs a registered case; managed implementation adapters need explicit tool opt-in, while generic command policy remains caller-defined. */
export async function evaluateCase(
  caseId: CaseId,
  options: {
    output: string;
    runner: EvaluationRunner;
    command?: CommandSpec;
    signal?: AbortSignal;
    timeoutMs?: number;
    versionTimeoutMs?: number;
    candidateRoot?: string;
    baseline?: Map<string, string>;
    executionAuthorization?: 'operator-approved' | 'verified-containment';
    toolAccess?: ToolAccess;
    piToolAccess?: ToolAccess;
  },
): Promise<RunResult> {
  const definition = caseRegistry[caseId];
  const toolAccess = normalizeToolAccess(options);
  if (definition.mode === 'implementation' && !options.executionAuthorization)
    throw new Error(
      `Case ${caseId} requires explicit operator approval or verified containment for agent execution.`,
    );
  if (definition.mode === 'implementation' && !options.candidateRoot)
    throw new Error(
      `Case ${caseId} needs an already-prepared candidateRoot; run fixture preparation first.`,
    );
  if (
    definition.mode === 'implementation' &&
    options.runner !== 'command' &&
    toolAccess !== 'enabled'
  )
    throw new Error(
      `Case ${caseId} is an implementation task; ${options.runner} tools must be explicitly enabled.`,
    );
  if (
    definition.mode === 'read-only' &&
    options.runner !== 'command' &&
    toolAccess === 'enabled'
  )
    throw new Error('Read-only cases keep managed-runner tools disabled.');
  throwIfAborted(options.signal);
  const context = await buildCaseInput(caseId);
  const command = resolveCommand({
    ...options,
    ...(toolAccess ? { toolAccess } : {}),
  });
  const ownsScratch = definition.mode === 'read-only';
  const scratch = ownsScratch
    ? await mkdtemp(join(tmpdir(), 'maelstrom-evaluation-'))
    : '';
  let runDir: string;
  try {
    runDir = await createPrivateRunDirectory(options.output);
  } catch (error) {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    throw error;
  }
  const source = join(
    docsRoot,
    'prompts/acceptance/fixtures',
    definition.fixture,
  );
  const cwd = options.candidateRoot
    ? await realpath(options.candidateRoot)
    : join(scratch, 'case');
  if (options.candidateRoot && isWithin(workspaceRoot, cwd))
    throw new Error('Candidate must be outside the workspace checkout');
  let processResult: ProcessResult | undefined;
  let changes: FileChange[] = [];
  let inspectionError: string | undefined;
  let before: Map<string, string> | undefined;
  let runnerVersion = 'unknown';
  let eventMetadata: { model?: string; provider?: string; sessionId?: string } =
    {};
  let transportStatus: string | undefined;
  try {
    if (ownsScratch) await copyTree(source, cwd);
    before = options.baseline ?? (await snapshot(cwd));
    processResult = await runCommand({
      command: command.invocation,
      ...(command.invocationEnv
        ? { env: { ...process.env, ...command.invocationEnv } }
        : {}),
      input: context.input,
      cwd,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    eventMetadata = command.parseMetadata?.(processResult.stdout) ?? {};
    const parsed = extractCommandText(command, processResult);
    transportStatus = parsed?.status;
    if (
      command.versionInvocation &&
      !processResult.cancelled &&
      !processResult.spawnError
    ) {
      const versionResult = await runCommand({
        command: command.versionInvocation,
        input: '',
        cwd,
        timeoutMs: options.versionTimeoutMs ?? 5_000,
        outputLimit: 4096,
        signal: options.signal,
      });
      runnerVersion =
        versionResult.exitCode === 0 &&
        !versionResult.timedOut &&
        !versionResult.cancelled &&
        !versionResult.outputTruncated
          ? versionResult.stdout.trim().slice(0, 256)
          : 'unknown';
    }
  } catch (error) {
    if (isAbortError(error)) processResult = cancelledProcessResult();
    else inspectionError = errorMessage(error);
  } finally {
    if (before)
      try {
        changes = diff(
          before,
          options.candidateRoot
            ? await snapshotCandidate(cwd)
            : await snapshot(cwd),
        );
      } catch (error) {
        inspectionError = errorMessage(error);
      }
    if (scratch)
      await rm(scratch, { recursive: true, force: true }).catch(
        (error: unknown) => {
          inspectionError ??= `Scratch cleanup failed: ${errorMessage(error)}`;
        },
      );
  }
  const proc = processResult ?? emptyProcessResult(inspectionError);
  const extracted = extractCommandText(command, proc);
  const applicationOutput =
    options.runner === 'command' ? proc.stdout : (extracted?.text ?? '');
  const candidateGrade =
    definition.mode === 'implementation' && before
      ? await gradeCandidate(caseId, {
          candidateRoot: cwd,
          baseline: before,
          timeoutMs: options.timeoutMs,
        })
      : undefined;
  const criteria =
    candidateGrade?.criteria ??
    gradeCaseEvidence(
      caseId,
      applicationOutput,
      Object.fromEntries(
        context.fixtureFiles.map((file) => [file.path, file.text]),
      ),
    );
  if (options.runner !== 'command')
    criteria.unshift({
      id: 'assistant-final-text',
      status: extracted?.status === 'ok' ? 'passed' : 'failed',
      evidence: `transport=${extracted?.status ?? 'unavailable'}`,
    });
  criteria.unshift({
    id: 'process-success',
    status:
      proc.exitCode === 0 &&
      !proc.spawnError &&
      !proc.stdinError &&
      !proc.timedOut &&
      !proc.cancelled &&
      (options.runner === 'command' || !proc.captureIncomplete)
        ? 'passed'
        : 'failed',
    evidence: `exit=${proc.exitCode}; signal=${proc.signal ?? 'none'}; timeout=${proc.timedOut}; cancelled=${proc.cancelled}`,
  });
  if (definition.mode === 'read-only') {
    const changeStatus =
      inspectionError || changes.length ? 'failed' : 'passed';
    const changeEvidence =
      inspectionError ?? `${changes.length} file change(s)`;
    const changeCriterion = criteria.find(
      (criterion) => criterion.id === 'read-only-zero-changes',
    );
    if (changeCriterion) {
      changeCriterion.status = changeStatus;
      changeCriterion.evidence = changeEvidence;
    } else {
      criteria.push({
        id: 'read-only-zero-changes',
        status: changeStatus,
        evidence: changeEvidence,
      });
    }
    criteria.push({
      id: 'tool-use-and-repository-inspection',
      status: 'unrun',
      evidence:
        options.runner === 'pi' ||
        options.runner === 'claude' ||
        options.runner === 'opencode'
          ? `${options.runner} requested tools=${toolAccess}; inherited configuration may still apply. Explicit fixture evidence supplied in prompt.`
          : 'Generic CLI tool policy and tool use are unknown.',
    });
  }
  const result: RunResult = {
    status: proc.cancelled
      ? 'cancelled'
      : proc.spawnError
        ? 'spawn-error'
        : 'completed',
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
    signal: proc.signal,
    ...(proc.spawnError ? { spawnError: proc.spawnError } : {}),
    ...(proc.stdinError ? { stdinError: proc.stdinError } : {}),
    durationMs: proc.durationMs,
    timedOut: proc.timedOut,
    cancelled: proc.cancelled,
    captureIncomplete: proc.captureIncomplete,
    changes,
    ...(inspectionError ? { inspectionError } : {}),
    criteria,
    manifest: {
      caseId,
      prompt: context.prompt,
      task: context.task,
      fixture: {
        path: `prompts/acceptance/fixtures/${definition.fixture}`,
        files: context.fixtureFiles.map(({ path, sha256 }) => ({
          path,
          sha256,
        })),
      },
      runner: {
        name: options.runner,
        version: runnerVersion,
        model: eventMetadata.model ?? 'unknown',
        provider: eventMetadata.provider ?? 'unknown',
        sessionId: eventMetadata.sessionId ?? 'unknown',
        executable: command.invocation.executable,
        command: [command.invocation.executable, ...command.invocation.args],
        tools:
          options.runner === 'pi' ||
          options.runner === 'claude' ||
          options.runner === 'opencode'
            ? {
                requested: toolAccess,
                guarantee:
                  options.runner === 'opencode'
                    ? 'child-only primary-agent wildcard deny; requested tool allowlist if enabled; inherited hooks/config remain'
                    : 'requested CLI policy; inherited configuration may apply',
              }
            : { requested: 'unknown', guarantee: 'unknown' },
      },
      transport:
        options.runner === 'command'
          ? { parser: 'plaintext', status: 'not-applicable' }
          : {
              parser: command.parserName ?? 'unknown',
              status: transportStatus ?? 'unavailable',
            },
      process: {
        exitCode: proc.exitCode,
        signal: proc.signal,
        spawnError: proc.spawnError ?? null,
        stdinError: proc.stdinError ?? null,
        durationMs: proc.durationMs,
        timedOut: proc.timedOut,
        cancelled: proc.cancelled,
        outputTruncated: proc.outputTruncated,
        captureIncomplete: proc.captureIncomplete,
      },
      changes,
      inspectionError: inspectionError ?? null,
      criteria,
      candidateGrader: candidateGrade
        ? candidateGraderEvidence(candidateGrade)
        : null,
      executionAuthorization: options.executionAuthorization ?? null,
      security: {
        privateOutputDirectory: runDir,
        filesystemSandbox: false,
        environmentSerialized: false,
        toolProfile:
          options.runner === 'pi'
            ? toolAccess === 'enabled'
              ? 'operator-authorized trusted-host tools; no OS confinement'
              : 'context-only; Pi tools disabled'
            : options.runner === 'claude' || options.runner === 'opencode'
              ? `requested ${toolAccess}; inherited configuration may apply; no OS confinement`
              : 'generic CLI; tool policy unknown',
      },
    },
  };
  await publishArtifacts(runDir, result);
  return result;
}

/** Captures the trusted pre-agent candidate tree for later scope/tamper grading. */
export async function snapshotCandidate(
  root: string,
): Promise<Map<string, string>> {
  const canonical = await realpath(root);
  if (isWithin(workspaceRoot, canonical))
    throw new Error('Candidate must be outside the workspace checkout');
  const entries = new Map<string, string>();
  const visit = async (directory: string) => {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const info = await lstat(path);
      const key = relative(canonical, path).split(sep).join('/');
      if (info.isSymbolicLink())
        entries.set(key, `SYMLINK:${await readlink(path)}`);
      else if (info.isDirectory()) await visit(path);
      else if (info.isFile()) entries.set(key, sha256(await readFile(path)));
      else throw new Error(`Candidate contains non-regular path: ${path}`);
    }
  };
  await visit(canonical);
  return entries;
}

export interface CandidateGrade {
  caseId: CaseId;
  harnessStatus: 'ready' | 'blocked' | 'error';
  criteria: RunResult['criteria'];
  commands: {
    command: string[];
    status: string;
    exitCode: number | null;
    timedOut: boolean;
    cancelled: boolean;
    durationMs: number;
    spawnError?: string;
    summary: string;
  }[];
  changedPaths: FileChange[];
  evidence: string[];
}

/** Returns bounded grader commands and process output for the private run manifest. */
export function candidateGraderEvidence(grade: CandidateGrade) {
  return {
    harnessStatus: grade.harnessStatus,
    evidence: grade.evidence,
    commands: grade.commands.map(
      ({
        command: argv,
        status,
        exitCode,
        timedOut,
        cancelled,
        durationMs,
        spawnError,
        summary,
      }) => ({
        argv,
        status,
        exitCode,
        timedOut,
        cancelled,
        durationMs,
        spawnError: spawnError ?? null,
        processEvidence: summary.slice(-2000),
      }),
    ),
    changedPaths: grade.changedPaths,
  };
}

/** Grades an already-produced implementation candidate using evaluator-owned checks. This never starts an agent. */
export async function gradeCandidate(
  caseId: CaseId,
  options: {
    candidateRoot: string;
    baseline: Map<string, string>;
    timeoutMs?: number;
  },
): Promise<CandidateGrade> {
  if (caseRegistry[caseId].mode !== 'implementation')
    throw new Error(`${caseId} is read-only; use evaluateCase`);
  const candidateRoot = await realpath(options.candidateRoot);
  if (isWithin(workspaceRoot, candidateRoot))
    throw new Error('Candidate must be outside the workspace checkout');
  const before = options.baseline;
  const commands: CandidateGrade['commands'] = [];
  const criteria: RunResult['criteria'] = [];
  const evidence: string[] = [];
  let harnessStatus: CandidateGrade['harnessStatus'] = 'ready';
  const checkCommand = async (
    spec: CommandSpec,
    id: string,
  ): Promise<boolean> => {
    const result = await runCommand({
      command: spec,
      input: '',
      cwd: candidateRoot,
      timeoutMs: options.timeoutMs,
    });
    commands.push({
      command: [spec.executable, ...spec.args],
      status: result.spawnError
        ? 'spawn-error'
        : result.timedOut
          ? 'timeout'
          : result.cancelled
            ? 'cancelled'
            : 'completed',
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      durationMs: result.durationMs,
      ...(result.spawnError ? { spawnError: result.spawnError } : {}),
      summary:
        `${result.stderr.slice(-1000)}${result.stdout.slice(-1000)}`.trim(),
    });
    const passed =
      result.exitCode === 0 &&
      !result.spawnError &&
      !result.stdinError &&
      !result.timedOut &&
      !result.cancelled;
    criteria.push({
      id,
      status: passed ? 'passed' : 'failed',
      evidence: `exit=${result.exitCode}; timeout=${result.timedOut}; spawnError=${result.spawnError ?? 'none'}`,
    });
    return passed;
  };
  const current = await snapshotCandidate(candidateRoot);
  const changes = diff(before, current);
  const protectedFiles =
    caseId === 'react-conversion'
      ? [
          'src/search.ts',
          'src/SearchPanel.test.tsx',
          'src/testConnector.ts',
          '.trial/noop',
          '.trial/sdk-probe.tsx',
          '.trial/sdk-runtime.ts',
          'package.json',
          'tsconfig.json',
          'vite.config.ts',
          'index.html',
        ]
      : [
          'src/testConnector.ts',
          '.trial/noop',
          '.trial/sdk-probe.tsx',
          '.trial/sdk-runtime.ts',
          'package.json',
          'project.json',
          'tsconfig.json',
          'vite.config.ts',
          'index.html',
        ];
  const protectedFailures = protectedFiles.filter(
    (path) =>
      before.has(path) !== current.has(path) ||
      (before.has(path) && before.get(path) !== current.get(path)),
  );
  const trustedFilesPassed = protectedFailures.length === 0;
  criteria.push({
    id: 'trusted-file-integrity',
    status: trustedFilesPassed ? 'passed' : 'failed',
    evidence: protectedFailures.length
      ? `protected grader/input files changed: ${protectedFailures.join(', ')}`
      : `protected files unchanged (${protectedFiles.length} paths)`,
  });
  const outOfScope = changes.filter((change) => {
    const symlink =
      change.afterHash?.startsWith('SYMLINK:') === true ||
      change.beforeHash?.startsWith('SYMLINK:') === true;
    const disposableOutput = isDisposableArtifactChange(change);
    return (
      symlink ||
      (!disposableOutput &&
        (!change.path.startsWith('src/') ||
          !/\.tsx?$/.test(change.path) ||
          (caseId === 'react-conversion' && change.path === 'src/search.ts') ||
          change.kind === 'deleted'))
    );
  });
  const allowlistPassed = outOfScope.length === 0;
  criteria.push({
    id: 'application-change-allowlist',
    status: allowlistPassed ? 'passed' : 'failed',
    evidence: outOfScope.length
      ? outOfScope.map(({ path, kind }) => `${kind}:${path}`).join(', ')
      : `${changes.length} candidate change(s); no protected/config/out-of-scope changes`,
  });
  if (!trustedFilesPassed || !allowlistPassed) {
    harnessStatus = 'blocked';
    for (const id of [
      'sdk-typecheck',
      'trusted-ui-behavior',
      'browser-chart-vessel',
    ])
      criteria.push({
        id,
        status: 'unrun',
        evidence:
          'Candidate changed protected or out-of-scope files; executable graders were not run.',
      });
    criteria.push({
      id: 'semantic-review',
      status: 'unrun',
      evidence: `Independent review required: ${definitionFor(caseId).rubric.join(' ')}`,
    });
    return {
      caseId,
      harnessStatus,
      criteria,
      commands,
      changedPaths: changes,
      evidence: [
        'Candidate executable checks skipped because input-integrity or file-scope verification failed.',
      ],
    };
  }
  const nodeModules = join(candidateRoot, 'node_modules');
  try {
    await lstat(nodeModules);
  } catch {
    harnessStatus = 'blocked';
    criteria.push({
      id: 'sdk-typecheck',
      status: 'unrun',
      evidence:
        'Candidate dependencies are not installed; gradeCandidate requires the prepared local SDK project.',
    });
    criteria.push({
      id: 'trusted-ui-behavior',
      status: 'unrun',
      evidence: 'Candidate dependencies are not installed.',
    });
    criteria.push({
      id: 'browser-chart-vessel',
      status: 'unrun',
      evidence: 'Candidate dependencies are not installed.',
    });
    criteria.push({
      id: 'semantic-review',
      status: 'unrun',
      evidence: `Independent review required: ${definitionFor(caseId).rubric.join(' ')}`,
    });
    return {
      caseId,
      harnessStatus,
      criteria,
      commands,
      changedPaths: changes,
      evidence,
    };
  }
  const typecheckPassed = await checkCommand(
    { executable: 'bun', args: ['run', 'typecheck'] },
    'sdk-typecheck',
  );
  let behaviorPassed = false;
  if (caseId === 'react-conversion') {
    const trustedDir = join(candidateRoot, '.evaluation-grade');
    try {
      await lstat(trustedDir);
      harnessStatus = 'blocked';
      criteria.push({
        id: 'trusted-ui-behavior',
        status: 'unrun',
        evidence: 'Candidate pre-created reserved evaluator directory.',
      });
    } catch {
      await mkdir(trustedDir, { mode: 0o700 });
      await copyFile(
        join(
          docsRoot,
          'prompts/evaluation/graders/react-conversion.grader.tsx',
        ),
        join(trustedDir, 'react-conversion.test.tsx'),
      );
      const vitest = join(candidateRoot, 'node_modules/.bin/vitest');
      behaviorPassed = await checkCommand(
        {
          executable: vitest,
          args: [
            'run',
            '--environment',
            'jsdom',
            '.evaluation-grade/react-conversion.test.tsx',
          ],
        },
        'trusted-ui-behavior',
      );
      await rm(trustedDir, { recursive: true, force: true });
    }
  } else {
    criteria.push({
      id: 'trusted-ui-behavior',
      status: 'passed',
      evidence:
        'Onboarding has no pre-existing interactive search behavior; visible content and Vessel geometry are asserted by browser grader.',
    });
  }
  if (
    harnessStatus === 'ready' &&
    typecheckPassed &&
    (caseId !== 'react-conversion' || behaviorPassed)
  ) {
    const browserScript = join(
      docsRoot,
      'prompts/evaluation/graders/browser-case.mjs',
    );
    const browserPassed = await checkCommand(
      {
        executable: process.execPath,
        args: [browserScript, candidateRoot, caseId],
      },
      'browser-chart-vessel',
    );
    if (!browserPassed)
      evidence.push(
        'Browser grader requires a visible SDK-rendered instance with nonzero geometry contained in Chart and case-specific visible UI assertions.',
      );
  } else {
    criteria.push({
      id: 'browser-chart-vessel',
      status: 'unrun',
      evidence: 'Earlier prerequisite failed or grader setup was blocked.',
    });
  }
  criteria.push({
    id: 'semantic-review',
    status: 'unrun',
    evidence: `Independent review required: ${definitionFor(caseId).rubric.join(' ')}`,
  });
  return {
    caseId,
    harnessStatus,
    criteria,
    commands,
    changedPaths: changes,
    evidence,
  };
}

/** Runs the legacy modeling CLI API. */
export async function evaluateModeling(options: {
  output: string;
  runner: EvaluationRunner;
  command?: CommandSpec;
  signal?: AbortSignal;
  timeoutMs?: number;
  versionTimeoutMs?: number;
  toolAccess?: ToolAccess;
  piToolAccess?: ToolAccess;
}): Promise<RunResult> {
  const toolAccess = normalizeToolAccess(options);
  if (options.runner !== 'command' && toolAccess === 'enabled')
    throw new Error(
      'The legacy modeling case is read-only; managed-runner tools must stay disabled.',
    );
  throwIfAborted(options.signal);
  const promptPath = join(
    docsRoot,
    'prompts/library/maelstrom-vessel-modeling.md',
  );
  const prompt = parsePromptSource(
    await readFile(promptPath, 'utf8'),
    'maelstrom-vessel-modeling.md',
  );
  const fixtureHash = await hashTree(fixtureRoot);
  const fixtureInput = await readFile(
    join(fixtureRoot, 'src/Queue.tsx'),
    'utf8',
  );
  throwIfAborted(options.signal);
  const command = resolveCommand({
    ...options,
    ...(toolAccess ? { toolAccess } : {}),
  });

  const fixture = await mkdtemp(join(tmpdir(), 'maelstrom-evaluation-'));
  let runDir: string;
  try {
    runDir = await createPrivateRunDirectory(options.output);
  } catch (error) {
    await rm(fixture, { recursive: true, force: true });
    throw error;
  }
  const cwd = join(fixture, 'case');
  let processResult: ProcessResult | undefined;
  let changes: FileChange[] = [];
  let inspectionError: string | undefined;
  const promptMetadata = prompt.metadata;
  const task = `Inventory the support-queue capability in src/Queue.tsx; identify observed user-visible states and operations, choose whether it should be one Vessel, and give an evidence-backed Vessel proposal. Do not edit files.`;
  const renderedTask = `${task}\n\nCase context file: src/Queue.tsx\n--- source begins ---\n${fixtureInput}\n--- source ends ---\n`;
  const input = `${prompt.body}\n\nEvaluation task:\n${renderedTask}`;
  let before: Map<string, string> | undefined;
  let after: Map<string, string> | undefined;
  let runnerVersion = 'unknown';
  let eventMetadata: { model?: string; provider?: string; sessionId?: string } =
    {};

  try {
    await copyTree(fixtureRoot, cwd);
    before = await snapshot(cwd);
    throwIfAborted(options.signal);
    processResult = await runCommand({
      command: command.invocation,
      ...(command.invocationEnv
        ? { env: { ...process.env, ...command.invocationEnv } }
        : {}),
      input,
      cwd,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    eventMetadata = command.parseMetadata?.(processResult.stdout) ?? {};
    if (
      command.versionInvocation &&
      !processResult.cancelled &&
      !options.signal?.aborted
    ) {
      const versionResult = await runCommand({
        command: command.versionInvocation,
        input: '',
        cwd,
        timeoutMs: options.versionTimeoutMs ?? 5_000,
        outputLimit: 4096,
        signal: options.signal,
      });
      if (versionResult.cancelled) {
        processResult = {
          ...processResult,
          cancelled: true,
          durationMs: processResult.durationMs + versionResult.durationMs,
        };
      }
      runnerVersion =
        versionResult.exitCode === 0 &&
        !versionResult.timedOut &&
        !versionResult.cancelled &&
        !versionResult.outputTruncated
          ? versionResult.stdout.trim().slice(0, 256)
          : 'unknown';
    }
  } catch (error) {
    if (isAbortError(error)) {
      processResult = cancelledProcessResult();
    } else {
      inspectionError = errorMessage(error);
    }
  } finally {
    if (before) {
      try {
        after = await snapshot(cwd);
        changes = diff(before, after);
      } catch (error) {
        inspectionError = errorMessage(error);
      }
    }
    if (fixture)
      await rm(fixture, { recursive: true, force: true }).catch(
        (error: unknown) => {
          inspectionError ??= `Scratch cleanup failed: ${errorMessage(error)}`;
        },
      );
  }

  const processEvidence = processResult ?? emptyProcessResult(inspectionError);
  const finalAnswer = extractCommandText(command, processEvidence);
  const criteria = [
    ...(options.runner === 'command'
      ? []
      : [
          {
            id: 'assistant-final-text',
            status:
              finalAnswer?.status === 'ok'
                ? ('passed' as const)
                : ('failed' as const),
            evidence: `transport=${finalAnswer?.status ?? 'unavailable'}`,
          },
        ]),
    {
      id: 'process-success',
      status:
        processEvidence.exitCode === 0 &&
        !processEvidence.spawnError &&
        !processEvidence.stdinError &&
        !processEvidence.timedOut &&
        !processEvidence.cancelled &&
        (options.runner === 'command' || !processEvidence.captureIncomplete)
          ? 'passed'
          : 'failed',
      evidence: `exit=${processEvidence.exitCode}; signal=${processEvidence.signal ?? 'none'}; timedOut=${processEvidence.timedOut}; cancelled=${processEvidence.cancelled}; stdinError=${processEvidence.stdinError ?? 'none'}`,
    },
    {
      id: 'read-only-zero-changes',
      status: inspectionError
        ? 'failed'
        : changes.length === 0
          ? 'passed'
          : 'failed',
      evidence: inspectionError ?? `${changes.length} file change(s)`,
    },
    {
      id: 'semantic-quality',
      status: 'unrun',
      evidence:
        'Requires independent human review; output and exit status are not semantic evidence.',
    },
    {
      id: 'tool-use-and-repository-inspection',
      status: 'unrun',
      evidence:
        options.runner === 'pi' ||
        options.runner === 'claude' ||
        options.runner === 'opencode'
          ? `${options.runner} requested tools=${options.toolAccess ?? options.piToolAccess ?? 'disabled'}; inherited settings may apply. Fixture bytes were supplied as explicit case context.`
          : 'Generic CLI tool policy and tool use were not evaluated; fixture bytes were supplied as explicit case context.',
    },
    {
      id: 'sdk-browser-live-engine',
      status: 'unrun',
      evidence: 'Not evaluated by this CLI case.',
    },
  ] as RunResult['criteria'];
  const durationMs = processEvidence.durationMs;
  const result: RunResult = {
    status: processEvidence.cancelled
      ? 'cancelled'
      : processEvidence.spawnError
        ? 'spawn-error'
        : 'completed',
    stdout: processEvidence.stdout,
    stderr: processEvidence.stderr,
    exitCode: processEvidence.exitCode,
    signal: processEvidence.signal,
    ...(processEvidence.spawnError
      ? { spawnError: processEvidence.spawnError }
      : {}),
    ...(processEvidence.stdinError
      ? { stdinError: processEvidence.stdinError }
      : {}),
    durationMs,
    timedOut: processEvidence.timedOut,
    cancelled: processEvidence.cancelled,
    captureIncomplete: processEvidence.captureIncomplete,
    changes,
    ...(inspectionError ? { inspectionError } : {}),
    criteria,
    manifest: {
      caseId: 'modeling-read-only',
      prompt: {
        id: promptMetadata.id,
        version: promptMetadata.prompt_version,
        bodySha256: sha256(prompt.body),
      },
      task: { text: renderedTask, sha256: sha256(renderedTask) },
      fixture: {
        path: 'prompts/acceptance/fixtures/modeling-react',
        sha256: fixtureHash,
      },
      runner: {
        name: options.runner,
        version: runnerVersion,
        executable: command.invocation.executable,
        command: [command.invocation.executable, ...command.invocation.args],
        model: eventMetadata.model ?? 'unknown',
        provider: eventMetadata.provider ?? 'unknown',
        tools:
          options.runner === 'pi' ||
          options.runner === 'claude' ||
          options.runner === 'opencode'
            ? {
                requested:
                  options.toolAccess ?? options.piToolAccess ?? 'disabled',
                guarantee: 'inherited settings may apply',
              }
            : { requested: 'unknown', guarantee: 'unknown' },
      },
      process: {
        exitCode: processEvidence.exitCode,
        signal: processEvidence.signal,
        spawnError: processEvidence.spawnError ?? null,
        stdinError: processEvidence.stdinError ?? null,
        durationMs,
        timedOut: processEvidence.timedOut,
        cancelled: processEvidence.cancelled,
        outputTruncated: processEvidence.outputTruncated,
        captureIncomplete: processEvidence.captureIncomplete,
      },
      changes,
      inspectionError: inspectionError ?? null,
      criteria,
      security: {
        environmentSerialized: false,
        privateOutputDirectory: runDir ?? null,
        filesystemSandbox: false,
        toolProfile:
          options.runner === 'pi'
            ? 'Pi tools disabled; cwd is not a filesystem sandbox'
            : options.runner === 'claude' || options.runner === 'opencode'
              ? `requested ${options.toolAccess ?? 'disabled'}; inherited configuration may apply; cwd is not a filesystem sandbox`
              : 'Generic CLI; cwd is not a filesystem sandbox',
      },
    },
  };
  if (runDir) await publishArtifacts(runDir, result);
  return result;
}

function parseOpenCodeInlineConfig(
  raw: string | undefined,
): Record<string, unknown> {
  if (!raw?.trim()) return {};
  const errors: import('jsonc-parser').ParseError[] = [];
  const parsed: unknown = parseJsonc(raw, errors, { allowTrailingComma: true });
  if (!isRecord(parsed) || errors.length > 0)
    throw new Error(
      'OPENCODE_CONFIG_CONTENT must be a valid JSON/JSONC object; its contents were not logged.',
    );
  if (parsed.agent !== undefined && !isRecord(parsed.agent))
    throw new Error(
      'OPENCODE_CONFIG_CONTENT agent entries must be an object; its contents were not logged.',
    );
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeToolAccess(options: {
  runner: EvaluationRunner;
  toolAccess?: ToolAccess;
  piToolAccess?: ToolAccess;
}): ToolAccess | undefined {
  if (
    options.toolAccess !== undefined &&
    options.piToolAccess !== undefined &&
    options.toolAccess !== options.piToolAccess
  )
    throw new Error('Conflicting --tools and --pi-tools values.');
  if (options.piToolAccess !== undefined && options.runner !== 'pi')
    throw new Error(
      'piToolAccess is Pi-only; use toolAccess for managed CLI runners.',
    );
  if (options.runner === 'command') {
    if (options.toolAccess !== undefined || options.piToolAccess !== undefined)
      throw new Error(
        'Generic command tool policy is caller-defined and cannot be asserted by the evaluator.',
      );
    return undefined;
  }
  return options.toolAccess ?? options.piToolAccess ?? 'disabled';
}

/** Resolves a runner's literal invocation and adapter-specific transport/policy settings. */
export function resolveCommand(options: {
  runner: EvaluationRunner;
  command?: CommandSpec;
  toolAccess?: ToolAccess;
  piToolAccess?: ToolAccess;
}): {
  invocation: CommandSpec;
  versionInvocation?: CommandSpec;
  invocationEnv?: NodeJS.ProcessEnv;
  parseMetadata?: (stdout: string) => {
    model?: string;
    provider?: string;
    sessionId?: string;
  };
  extractText?: (
    stdout: string,
    truncated: boolean,
  ) => { text?: string; status: string };
  parserName?: string;
} {
  if (options.runner === 'command') {
    if (!options.command?.executable)
      throw new Error('Generic command runner requires an executable');
    return { invocation: options.command };
  }
  if (options.runner === 'claude') {
    const executable = process.env.CLAUDE_CLI ?? 'claude';
    const enabled = options.toolAccess === 'enabled';
    return {
      invocation: {
        executable,
        args: [
          '-p',
          '--output-format',
          'json',
          '--permission-mode',
          'dontAsk',
          '--tools',
          enabled ? 'Read,Write,Edit,Bash,Glob,Grep' : '',
          ...(enabled
            ? ['--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep']
            : []),
          '--disallowedTools',
          'mcp__*',
        ],
      },
      versionInvocation: { executable, args: ['--version'] },
      extractText: extractClaudeResult,
      parseMetadata: parseClaudeMetadata,
      parserName: 'claude-print-json-result',
    };
  }
  if (options.runner === 'opencode') {
    const executable = process.env.OPENCODE_CLI ?? 'opencode';
    const agent = `maelstrom-evaluation-${randomUUID()}`;
    const enabledTools = [
      'bash',
      'edit',
      'write',
      'read',
      'list',
      'glob',
      'grep',
    ];
    const permission = Object.fromEntries([
      ['*', 'deny'],
      ...[
        'bash',
        'edit',
        'write',
        'apply_patch',
        'read',
        'list',
        'glob',
        'grep',
        'lsp',
        'webfetch',
        'websearch',
        'skill',
        'task',
        'question',
        'plan_enter',
        'plan_exit',
        'todowrite',
      ].map((tool) => [
        tool,
        options.toolAccess === 'enabled' && enabledTools.includes(tool)
          ? 'allow'
          : 'deny',
      ]),
    ]);
    const inlineConfig = parseOpenCodeInlineConfig(
      process.env.OPENCODE_CONFIG_CONTENT,
    );
    const config = {
      ...inlineConfig,
      agent: {
        ...(inlineConfig.agent as Record<string, unknown> | undefined),
        [agent]: { mode: 'primary', permission },
      },
    };
    return {
      invocation: {
        executable,
        args: ['--pure', 'run', '--format', 'json', '--agent', agent],
      },
      versionInvocation: { executable, args: ['--version'] },
      invocationEnv: {
        OPENCODE_PERMISSION: JSON.stringify(permission),
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      },
      extractText: extractOpenCodeResult,
      parseMetadata: parseOpenCodeMetadata,
      parserName: 'opencode-1.18.32-jsonl-final-step',
    };
  }
  const executable = process.env.PI_CLI ?? 'pi';
  return {
    invocation: {
      executable,
      args: [
        '--mode',
        'json',
        '--no-session',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '--no-context-files',
        ...(options.toolAccess === 'enabled'
          ? ['--tools', 'read,write,edit,bash,grep,find,ls']
          : ['--no-tools']),
        '-p',
        '--',
      ],
    },
    versionInvocation: { executable, args: ['--version'] },
    parseMetadata: parsePiMetadata,
    extractText: (stdout, truncated) =>
      extractPiAssistantText(stdout, truncated),
    parserName: 'pi-jsonl-final-assistant-message',
  };
}

async function createPrivateRunDirectory(output: string): Promise<string> {
  const requested = resolve(output);
  const missing: string[] = [];
  let ancestor = requested;
  while (true) {
    try {
      await lstat(ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.push(ancestor);
      ancestor = parent;
    }
  }
  const canonicalAncestor = await realpath(ancestor);
  if (isWithin(workspaceRoot, canonicalAncestor)) {
    throw new Error('Output directory must be outside the workspace checkout');
  }
  const canonicalDestination = resolve(
    canonicalAncestor,
    ...missing
      .reverse()
      .map((path) => relative(dirname(path), path).split(sep).at(-1) ?? path),
  );
  if (isWithin(workspaceRoot, canonicalDestination)) {
    throw new Error('Output directory must be outside the workspace checkout');
  }
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const outputResolved = await realpath(requested);
  if (isWithin(workspaceRoot, outputResolved)) {
    throw new Error('Output directory must be outside the workspace checkout');
  }
  await chmod(outputResolved, 0o700);
  const runDir = await mkdtemp(join(outputResolved, 'run-'));
  await chmod(runDir, 0o700);
  return runDir;
}

async function publishArtifacts(
  runDir: string,
  result: RunResult,
): Promise<void> {
  await writeFile(join(runDir, 'stdout.jsonl'), result.stdout, { mode: 0o600 });
  await writeFile(join(runDir, 'stderr.txt'), result.stderr, { mode: 0o600 });
  await writeFile(
    join(runDir, 'manifest.json'),
    `${JSON.stringify(result.manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
}

class BoundedCapture {
  #chunks: Buffer[] = [];
  #length = 0;
  truncated = false;

  constructor(readonly limit: number) {}

  add(chunk: Buffer): void {
    const remaining = this.limit - this.#length;
    if (remaining <= 0) {
      this.truncated ||= chunk.length > 0;
      return;
    }
    const accepted = chunk.subarray(0, remaining);
    this.#chunks.push(Buffer.from(accepted));
    this.#length += accepted.length;
    this.truncated ||= accepted.length < chunk.length;
  }

  text(): string {
    return Buffer.concat(this.#chunks, this.#length).toString('utf8');
  }
}

function signalOwned(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid && process.platform !== 'win32')
      process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // A process group may already have exited.
  }
}

export function extractPiAssistantText(
  stdout: string,
  outputTruncated = false,
): {
  text?: string;
  status: 'ok' | 'truncated' | 'invalid-jsonl' | 'no-final-assistant-text';
} {
  if (outputTruncated) return { status: 'truncated' };
  let finalMessage: Record<string, unknown> | undefined;
  let sawEvent = false;
  for (const line of stdout.split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (!event || typeof event !== 'object' || typeof event.type !== 'string')
        continue;
      sawEvent = true;
      if (event.type === 'message_end') {
        const message = event.message as Record<string, unknown> | undefined;
        if (message?.role === 'assistant') finalMessage = message;
      }
    } catch {
      return { status: 'invalid-jsonl' };
    }
  }
  if (!sawEvent) return { status: 'invalid-jsonl' };
  if (!finalMessage) return { status: 'no-final-assistant-text' };
  const content = finalMessage.content;
  if (typeof content === 'string' && content.trim())
    return { text: content, status: 'ok' };
  if (!Array.isArray(content)) return { status: 'no-final-assistant-text' };
  const parts = content as Record<string, unknown>[];
  if (
    parts.some(
      (part) => part && (part.type === 'toolCall' || part.type === 'tool_call'),
    )
  )
    return { status: 'no-final-assistant-text' };
  const text = parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
  return text.trim()
    ? { text, status: 'ok' }
    : { status: 'no-final-assistant-text' };
}

function extractCommandText(
  command: ReturnType<typeof resolveCommand>,
  processResult: ProcessResult,
) {
  if (processResult.captureIncomplete && command.parserName !== undefined)
    return { status: 'capture-incomplete' };
  const extracted = command.extractText?.(
    processResult.stdout,
    processResult.outputTruncated,
  );
  if (
    command.parserName === 'opencode-1.18.32-jsonl-final-step' &&
    /agent .*?(not found|not a primary agent)|Falling back to default agent/i.test(
      processResult.stderr,
    )
  )
    return { status: 'agent-selection-fallback' };
  return extracted;
}

export function extractOpenCodeResult(
  stdout: string,
  truncated = false,
): { text?: string; status: string } {
  if (truncated) return { status: 'truncated' };
  const lines = stdout.split('\n').filter(Boolean);
  if (!lines.length) return { status: 'no-events' };
  let sessionID: string | undefined;
  let activeStep: { messageID: string; text: string[] } | undefined;
  let finalText: string | undefined;
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { status: 'invalid-jsonl' };
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string')
      return { status: 'invalid-event-envelope' };
    const event = parsed;
    if (
      typeof event.sessionID !== 'string' ||
      (sessionID !== undefined && sessionID !== event.sessionID)
    )
      return { status: 'mixed-or-missing-session' };
    sessionID = event.sessionID;
    if (event.type === 'error') return { status: 'error-event' };
    if (event.type === 'step_start') {
      if (activeStep) return { status: 'unfinished-step-before-next-step' };
      const part = event.part;
      if (!isRecord(part) || part.type !== 'step-start')
        return { status: 'incomplete-step-start' };
      const common = openCodePartIdentity(part, sessionID);
      if (common.status !== 'ok') return common;
      activeStep = { messageID: common.messageID, text: [] };
      finalText = undefined;
      continue;
    }
    if (event.type === 'step_finish') {
      const part = event.part;
      if (!isRecord(part) || part.type !== 'step-finish')
        return { status: 'incomplete-step-finish' };
      const common = openCodePartIdentity(part, sessionID);
      if (common.status !== 'ok') return common;
      if (!activeStep || activeStep.messageID !== common.messageID)
        return { status: 'step-finish-without-active-step' };
      if (typeof part.reason !== 'string')
        return { status: 'incomplete-step-finish' };
      finalText = part.reason === 'stop' ? activeStep.text.join('') : undefined;
      activeStep = undefined;
      continue;
    }
    if (event.type === 'text') {
      const part = event.part;
      if (!isRecord(part) || part.type !== 'text')
        return { status: 'incomplete-text-part' };
      const common = openCodePartIdentity(part, sessionID);
      if (common.status !== 'ok') return common;
      if (!activeStep || activeStep.messageID !== common.messageID)
        return { status: 'text-outside-active-step' };
      if (
        typeof part.text !== 'string' ||
        !isRecord(part.time) ||
        typeof part.time.end !== 'number'
      )
        return { status: 'incomplete-text-part' };
      activeStep.text.push(part.text);
      continue;
    }
    if (event.type === 'tool_use' || event.type === 'reasoning') {
      if (event.part !== undefined) {
        if (!isRecord(event.part)) return { status: 'invalid-event-part' };
        const common = openCodePartIdentity(event.part, sessionID);
        if (common.status !== 'ok') return common;
        if (!activeStep || activeStep.messageID !== common.messageID)
          return { status: 'part-outside-active-step' };
      }
      continue;
    }
    return { status: 'unsupported-event-type' };
  }
  if (activeStep) return { status: 'unfinished-final-step' };
  return finalText?.trim()
    ? { text: finalText, status: 'ok' }
    : { status: 'no-final-step-text' };
}

function parseOpenCodeMetadata(stdout: string): { sessionId?: string } {
  for (const line of stdout.split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (typeof event.sessionID === 'string')
        return { sessionId: event.sessionID };
    } catch {
      return {};
    }
  }
  return {};
}

function openCodePartIdentity(
  part: Record<string, unknown>,
  sessionID: string,
):
  | { messageID: string; status: 'ok' }
  | { status: 'nested-session-mismatch' | 'missing-part-message-id' } {
  if (part.sessionID !== sessionID)
    return { status: 'nested-session-mismatch' };
  if (typeof part.messageID !== 'string')
    return { status: 'missing-part-message-id' };
  return { messageID: part.messageID, status: 'ok' };
}

export function extractClaudeResult(
  stdout: string,
  truncated = false,
): { text?: string; status: string } {
  if (truncated) return { status: 'truncated' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { status: 'invalid-json' };
  }
  if (!isRecord(parsed)) return { status: 'invalid-envelope' };
  const result = parsed;
  if (typeof result.subtype !== 'string') return { status: 'invalid-envelope' };
  if (result.is_error === true || result.subtype !== 'success')
    return { status: 'error-result' };
  if (typeof result.result !== 'string' || !result.result.trim())
    return { status: 'no-final-result' };
  return { text: result.result, status: 'ok' };
}

function parseClaudeMetadata(stdout: string): {
  model?: string;
  provider?: string;
  sessionId?: string;
} {
  try {
    const value = JSON.parse(stdout) as Record<string, unknown>;
    return {
      sessionId:
        typeof value.session_id === 'string' ? value.session_id : undefined,
      model: typeof value.model === 'string' ? value.model : undefined,
      provider: typeof value.provider === 'string' ? value.provider : undefined,
    };
  } catch {
    return {};
  }
}

function parsePiMetadata(stdout: string): {
  model?: string;
  provider?: string;
} {
  let final: { model?: string; provider?: string } = {};
  for (const line of stdout.split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const data = event.message as Record<string, unknown> | undefined;
      if (event.type !== 'message_end' || data?.role !== 'assistant') continue;
      final = {
        model: typeof data.model === 'string' ? data.model : undefined,
        provider: typeof data.provider === 'string' ? data.provider : undefined,
      };
    } catch {
      /* Non-JSON diagnostic line. */
    }
  }
  return final;
}

async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true, mode: 0o700 });
  for (const name of await readdir(from)) {
    const source = join(from, name);
    const destination = join(to, name);
    const info = await lstat(source);
    if (info.isSymbolicLink())
      throw new Error(`Fixture contains a symlink: ${source}`);
    if (info.isDirectory()) await copyTree(source, destination);
    else if (info.isFile()) await copyFile(source, destination);
    else throw new Error(`Fixture contains a non-regular file: ${source}`);
  }
}

async function snapshot(root: string): Promise<Map<string, string>> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error(`Run fixture root was removed or replaced: ${root}`);
  }
  const entries = new Map<string, string>();
  const visit = async (directory: string) => {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const info = await lstat(path);
      if (info.isSymbolicLink())
        throw new Error(`Run created a symlink: ${path}`);
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) {
        entries.set(
          relative(root, path).split(sep).join('/'),
          sha256(await readFile(path)),
        );
      } else throw new Error(`Run created a non-regular file: ${path}`);
    }
  };
  await visit(root);
  return entries;
}

async function hashTree(root: string): Promise<string> {
  const entries = await snapshot(root);
  return sha256(
    [...entries]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, hash]) => `${path}\0${hash}`)
      .join('\n'),
  );
}

const disposableArtifactRoots = [
  '.vite/',
  'node_modules/.vite/',
  'dist/',
  'coverage/',
  'test-results/',
  'playwright-report/',
];

export function isDisposableArtifactChange(change: FileChange): boolean {
  return disposableArtifactRoots.some((root) => change.path.startsWith(root));
}

/** Returns added, deleted and content-modified file paths between snapshots. */
export function diff(
  before: Map<string, string>,
  after: Map<string, string>,
): FileChange[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].sort().flatMap((path) => {
    const oldHash = before.get(path);
    const newHash = after.get(path);
    if (oldHash === newHash) return [];
    return [
      {
        path,
        kind:
          oldHash === undefined
            ? ('added' as const)
            : newHash === undefined
              ? ('deleted' as const)
              : ('modified' as const),
        ...(oldHash ? { beforeHash: oldHash } : {}),
        ...(newHash ? { afterHash: newHash } : {}),
      },
    ];
  });
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    path === '' ||
    (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Evaluation cancelled before process startup');
    error.name = 'AbortError';
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function emptyProcessResult(error?: string): ProcessResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: null,
    ...(error ? { spawnError: error } : {}),
    durationMs: 0,
    timedOut: false,
    cancelled: false,
    outputTruncated: false,
    captureIncomplete: false,
  };
}

function cancelledProcessResult(): ProcessResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: null,
    durationMs: 0,
    timedOut: false,
    cancelled: true,
    outputTruncated: false,
    captureIncomplete: false,
  };
}

function failedSpawn(startedAt: number, error: unknown): ProcessResult {
  return {
    ...emptyProcessResult(errorMessage(error)),
    durationMs: Date.now() - startedAt,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let caseId: string | undefined;
  let runner: string | undefined;
  let output: string | undefined;
  let executable: string | undefined;
  let candidateRoot: string | undefined;
  let authorization: 'operator-approved' | 'verified-containment' | undefined;
  let toolAccess: ToolAccess | undefined;
  let piToolFlag = false;
  let cliError = false;
  const commandArgs: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === '--arg') {
      if (value !== undefined) commandArgs.push(value);
      index++;
    } else if (flag === '--case') {
      caseId = value;
      index++;
    } else if (flag === '--runner') {
      runner = value;
      index++;
    } else if (flag === '--output') {
      output = value;
      index++;
    } else if (flag === '--command') {
      executable = value;
      index++;
    } else if (flag === '--candidate-root') {
      candidateRoot = value;
      index++;
    } else if (
      flag === '--authorize-coding' &&
      (value === 'operator-approved' || value === 'verified-containment')
    ) {
      authorization = value;
      index++;
    } else if (
      (flag === '--tools' || flag === '--pi-tools') &&
      (value === 'enabled' || value === 'disabled')
    ) {
      if (toolAccess && toolAccess !== value) {
        console.error('Conflicting --tools and --pi-tools values');
        process.exitCode = 2;
        cliError = true;
        break;
      }
      toolAccess = value;
      piToolFlag ||= flag === '--pi-tools';
      index++;
    } else if (flag === '--tools' || flag === '--pi-tools') {
      console.error(`${flag} requires enabled or disabled`);
      process.exitCode = 2;
      cliError = true;
      break;
    }
  }
  if (
    cliError ||
    !caseId ||
    !isCaseId(caseId) ||
    (runner !== 'pi' &&
      runner !== 'command' &&
      runner !== 'opencode' &&
      runner !== 'claude') ||
    !output ||
    (runner === 'command' && !executable) ||
    (toolAccess !== undefined && runner === 'command') ||
    (piToolFlag && runner !== 'pi') ||
    (toolAccess === 'enabled' &&
      runner !== 'pi' &&
      runner !== 'claude' &&
      runner !== 'opencode')
  ) {
    console.error(
      `Usage: bun run --cwd apps/docs prompts:evaluate --case <${Object.keys(caseRegistry).join('|')}> --runner <pi|opencode|claude|command> --output <private-outside-checkout-dir> [--candidate-root <prepared-trial-project> --authorize-coding <operator-approved|verified-containment> --tools enabled] [--command <executable> --arg <argv> ...]`,
    );
    process.exitCode = 2;
  } else {
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort());
    process.once('SIGTERM', () => controller.abort());
    const baselinePromise = candidateRoot
      ? snapshotCandidate(candidateRoot)
      : Promise.resolve(undefined);
    const evaluation = baselinePromise.then((baseline) =>
      evaluateCase(caseId as CaseId, {
        output,
        runner,
        ...(runner === 'command' && executable
          ? { command: { executable, args: commandArgs } }
          : {}),
        signal: controller.signal,
        ...(candidateRoot ? { candidateRoot, baseline } : {}),
        ...(authorization ? { executionAuthorization: authorization } : {}),
        ...(toolAccess ? { toolAccess } : {}),
      }),
    );
    evaluation
      .then((result) => {
        const { stdout: _stdout, stderr: _stderr, ...summary } = result;
        console.log(JSON.stringify(summary, null, 2));
        if (result.criteria.some((criterion) => criterion.status === 'failed'))
          process.exitCode = 1;
      })
      .catch((error: unknown) => {
        console.error(errorMessage(error));
        process.exitCode = 1;
      });
  }
}
