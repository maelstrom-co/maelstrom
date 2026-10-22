import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { skillTasks } from '../../src/lib/skill-onboarding';
import { createSkillsBundle } from './bundle';
import {
  credentialSandbox,
  runTrialProcess,
  trialSnapshot,
} from './trial-runtime';

interface ToolStart {
  type: 'tool_execution_start';
  toolCallId: string;
  toolName: string;
  args: { path?: string; command?: string };
}

interface SessionHeader {
  type: 'session';
  cwd: string;
  id: string;
}

const workspace = resolve(import.meta.dir, '../../../..');
const evidence = await mkdtemp(
  join(process.env.TMPDIR ?? tmpdir(), 'maelstrom-skill-discovery-'),
);
const originalProfile =
  process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');
const profile = join(evidence, 'profile');
const home = join(evidence, 'home');
const protectedCredentials: string[] = [];
const env: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: home,
  PI_CODING_AGENT_DIR: profile,
  PI_TELEMETRY: '0',
  XDG_CONFIG_HOME: join(evidence, 'config'),
  XDG_STATE_HOME: join(evidence, 'state'),
  DO_NOT_TRACK: '1',
  DISABLE_TELEMETRY: '1',
};
for (const key of Object.keys(env)) {
  if (key.startsWith('OPENCODE_') || key === 'OPENCODE') delete env[key];
}
const model = process.env.MAELSTROM_SKILLS_MODEL ?? 'openai-codex/gpt-6.1-sol';
let server: ReturnType<typeof Bun.serve> | undefined;
const scenarios = [
  {
    name: 'onboarding',
    procedure: 'maelstrom-project-onboarding',
    prompt:
      'Plan one bounded Maelstrom integration for this React application. Inspect the existing capability and installed dependencies. Do not edit files or install packages. Report the pilot, API evidence or missing SDK, checks not run, and rollback.',
  },
  {
    name: 'migration',
    procedure: 'maelstrom-react-migration',
    prompt:
      'Plan migrating the existing Orders capability to Maelstrom behind useMaelstromOrders. Preserve application-owned data and the legacy path. Do not edit files or install packages. Report API evidence, parity tests, and rollback.',
  },
  {
    name: 'voice',
    procedure: 'maelstrom-voice-integration',
    prompt:
      'Plan optional Maelstrom voice input for showing Orders. Provider and deployment are undecided; keep them open. Inspect the local architecture guidance. Do not edit files or install packages. Report ownership, runtime Turn Mode, and untested live scenarios.',
  },
] as const;
const results: Record<string, unknown>[] = [];

async function run(
  cwd: string,
  command: string[],
  label: string,
): Promise<string> {
  const stdout = join(evidence, `${label}.stdout`);
  const stderr = join(evidence, `${label}.stderr`);
  const executable =
    command[0] === 'pi'
      ? [
          '/usr/bin/sandbox-exec',
          '-p',
          credentialSandbox(protectedCredentials),
          ...command,
        ]
      : command;
  await runTrialProcess(
    cwd,
    executable,
    { ...env, PWD: cwd, OLDPWD: cwd },
    stdout,
    stderr,
  );
  return readFile(stdout, 'utf8');
}

try {
  console.log(`Evidence: ${evidence}`);
  assert.equal(
    process.platform,
    'darwin',
    'This optional CLI test requires macOS sandbox-exec for read-only credential access.',
  );
  assert(
    await Bun.file('/usr/bin/sandbox-exec').exists(),
    'sandbox-exec is required; credentials will not be linked without it.',
  );
  await mkdir(profile);
  await mkdir(home);
  for (const name of ['auth.json', 'models.json']) {
    const source = join(originalProfile, name);
    if (await Bun.file(source).exists()) {
      const canonical = await realpath(source);
      const reference = join(profile, name);
      protectedCredentials.push(canonical, reference);
      await symlink(canonical, reference);
    }
  }
  const zip = await createSkillsBundle(
    join(workspace, 'apps/docs/skills'),
    join(workspace, 'docs'),
  );
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return new Response(new Uint8Array(zip), {
        headers: { 'Content-Type': 'application/zip' },
      });
    },
  });
  for (const scenario of scenarios) {
    const project = join(evidence, scenario.name);
    await mkdir(join(project, 'src'), { recursive: true });
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({
        name: `consumer-${scenario.name}`,
        private: true,
        type: 'module',
      }),
    );
    await writeFile(
      join(project, 'src/App.tsx'),
      'export const useMaelstromOrders = false;\nexport const orders = [{ id: "order-1", total: 42, status: "pending" }];\nexport function Orders() { return <section aria-label="Orders"><h1>Orders</h1>{orders.map(order => <p key={order.id}>{order.id}: {order.status}, {order.total}</p>)}</section>; }\nexport function App() { return <main><Orders /></main>; }\n',
    );
    await writeFile(
      join(project, 'AGENTS.md'),
      "Keep application data and authorization application-owned. Follow the user's requested authority. For inspection, use read, grep, find, or ls. Stay inside this project. Distinguish observed facts and checks from proposals.\n",
    );
    await run(
      project,
      [
        'bunx',
        'skills@1.7.0',
        'add',
        `${server.url}bundle.zip`,
        '--skill',
        '*',
        '--agent',
        'pi',
        '--copy',
        '--yes',
      ],
      `install-${scenario.name}`,
    );
    const before = await trialSnapshot(project);
    const separator = model.indexOf('/');
    assert(
      separator > 0,
      'Use a provider/model identifier for the optional acceptance run.',
    );
    const readiness = await run(
      project,
      [
        'pi',
        'auth',
        'check',
        '--provider',
        model.slice(0, separator),
        '--model',
        model.slice(separator + 1),
        '--json',
        '--no-refresh',
      ],
      `auth-ready-${scenario.name}`,
    );
    assert.equal(
      JSON.parse(readiness).status,
      'ready',
      'Authenticate Pi separately; the trial will not refresh or modify stored credentials.',
    );
    const command = [
      'pi',
      '--model',
      model,
      '--thinking',
      'low',
      '--extension',
      join(import.meta.dir, 'trial-guard.ts'),
      '--approve',
      '--offline',
      '--no-session',
      '--tools',
      'read,grep,find,ls,bash,edit,write',
      '--print',
      '--mode',
      'json',
      scenario.prompt,
    ];
    assert(
      !command.includes('--skill') && !command.includes('--no-skills'),
      'Normal project discovery must not be overridden',
    );
    const raw = await run(project, command, `agent-${scenario.name}`);
    const events = raw
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line));
    const header = events[0] as SessionHeader;
    assert.equal(header.type, 'session');
    assert.equal(header.cwd, project);
    const catalog = events.find(
      (event) =>
        event.type === 'message_end' && event.message.role === 'system',
    )?.message.sections?.skills;
    assert.equal(
      typeof catalog,
      'string',
      'Startup did not advertise a skill catalog',
    );
    for (const name of ['maelstrom', ...skillTasks.map((task) => task.id)]) {
      assert(
        catalog.includes(`<name>${name}</name>`) &&
          catalog.includes(join(project, '.pi/skills', name, 'SKILL.md')),
        'Startup discovery did not expose the expected project skill',
      );
    }
    const calls = events.filter(
      (event) => event.type === 'tool_execution_start',
    ) as ToolStart[];
    const successful = new Set(
      events
        .filter(
          (event) =>
            event.type === 'tool_execution_end' &&
            !event.isError &&
            !event.result?.isError,
        )
        .map((event) => event.toolCallId),
    );
    const readPaths = calls
      .filter(
        (event) =>
          event.toolName === 'read' && successful.has(event.toolCallId),
      )
      .map((event) => event.args.path ?? '');
    for (const path of readPaths)
      assert(
        resolve(project, path).startsWith(`${project}${sep}`) ||
          resolve(project, path) === project,
      );
    const selected = readPaths
      .filter(
        (path) => path.endsWith('/SKILL.md') && path.includes('.pi/skills/'),
      )
      .map((path) => path.split('/').at(-2));
    assert(
      selected.includes(scenario.procedure),
      `${scenario.name} did not discover its procedure`,
    );
    assert.deepEqual(
      [...new Set(selected.filter((name) => name !== 'maelstrom'))],
      [scenario.procedure],
    );
    for (const call of calls.filter(
      (call) =>
        call.toolName === 'read' && call.args.path?.endsWith('/SKILL.md'),
    )) {
      const completed = events.find(
        (event) =>
          event.type === 'tool_execution_end' &&
          event.toolCallId === call.toolCallId,
      );
      assert(
        completed && !completed.isError && !completed.result?.isError,
        'A required skill read failed',
      );
      const installed = await readFile(
        resolve(project, call.args.path ?? ''),
        'utf8',
      );
      const heading = installed.match(/^# .+$/m)?.[0];
      assert(
        heading && JSON.stringify(completed.result).includes(heading),
        'Skill content was not delivered by the successful read',
      );
    }
    assert(
      !calls.some((call) => ['edit', 'write', 'bash'].includes(call.toolName)),
      'A plan-only trial attempted a mutation or shell operation',
    );
    assert.deepEqual(
      await trialSnapshot(project),
      before,
      'Plan-only trial changed its consumer',
    );
    const messages = events.filter(
      (event) =>
        event.type === 'message_end' && event.message.role === 'assistant',
    );
    assert.equal(messages.at(-1)?.message.stopReason, 'stop');
    const text = messages
      .flatMap((event) =>
        event.message.content
          .filter((part: { type: string }) => part.type === 'text')
          .map((part: { text: string }) => part.text),
      )
      .join('\n');
    await writeFile(join(evidence, `${scenario.name}.answer.md`), text);
    if (scenario.name === 'voice') {
      for (const suffix of [
        'realtime-voice-architecture.md',
        'architecture.md',
      ])
        assert(
          readPaths.some(
            (path) => path === suffix || path.endsWith(`/${suffix}`),
          ),
        );
      assert(
        !readPaths.some((path) => path.endsWith('provider-deployment.md')),
      );
    }
    results.push({
      scenario: scenario.name,
      model,
      selected,
      defaultDiscoveryInvocation: true,
      startupCatalogVerified: true,
      successfulWorkflowRead: true,
      applicationReview: 'pending manual review of answer and trace',
      sourceUnchanged: true,
      session: header.id,
    });
    console.log(
      `READ/SELECTION ${scenario.name}: ${selected.join(' -> ')}; application review remains manual`,
    );
  }
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify(results, null, 2),
  );
} catch (error) {
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify({ completed: results, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  server?.stop(true);
  for (const name of ['auth.json', 'models.json']) {
    const path = join(profile, name);
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(
          `Failed to remove temporary credential reference: ${path}`,
        );
        process.exitCode = 1;
      }
    }
  }
}
