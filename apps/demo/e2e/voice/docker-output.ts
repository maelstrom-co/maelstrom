import { randomBytes } from 'node:crypto';

export const dockerOutputTokenEnvironment =
  'MAELSTROM_VOICE_DOCKER_OUTPUT_TOKEN';

export interface DockerOutput {
  readonly stdout: string;
  readonly stderr: string;
}

function redact(text: string, environment: NodeJS.ProcessEnv): string {
  const secrets = [
    'MAELSTROM_E2E_OPENAI_API_KEY',
    'ELEVENLABS_API_KEY',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'GHCR_TOKEN',
  ]
    .map((name) => environment[name])
    .filter((value): value is string => !!value)
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) text = text.replaceAll(secret, '[REDACTED]');
  return text;
}

function framePrefix(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error('Invalid Docker output token');
  return `[voice-docker-output:${token}] `;
}

export function encodeDockerOutput(
  output: DockerOutput,
  token: string,
  environment: NodeJS.ProcessEnv,
): string {
  return `${framePrefix(token)}${JSON.stringify({
    stdout: redact(output.stdout, environment),
    stderr: redact(output.stderr, environment),
  })}\n`;
}

// The token is held by the trusted harness and removed from subprocess environments.
// Unlike lifecycle records, authenticated Docker output is not size/count limited.
export function dockerOutputConsumer(
  token: string,
  onOutput: (output: DockerOutput) => void,
): (chunk: string) => void {
  const prefix = framePrefix(token);
  let pending = '';
  let dropping = false;
  return (chunk) => {
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf('\n', start);
      if (!dropping) {
        const part = chunk.slice(start, end < 0 ? chunk.length : end);
        const header = (pending + part).slice(0, prefix.length);
        if (prefix.startsWith(header)) pending += part;
        else {
          pending = '';
          dropping = true;
        }
      }
      if (end < 0) return;
      if (!dropping && pending.startsWith(prefix)) {
        let value: unknown;
        try {
          value = JSON.parse(pending.slice(prefix.length));
        } catch {
          // Unframed/malformed child output is not a Docker failure payload.
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const record = value as Record<string, unknown>;
          if (
            Object.keys(record).length === 2 &&
            typeof record.stdout === 'string' &&
            typeof record.stderr === 'string'
          )
            onOutput({ stdout: record.stdout, stderr: record.stderr });
        }
      }
      pending = '';
      dropping = false;
      start = end + 1;
    }
  };
}

export function logDockerOutput(
  output: DockerOutput,
  environment: NodeJS.ProcessEnv,
  log: (block: string) => void = console.log,
): void {
  for (const stream of ['stdout', 'stderr'] as const) {
    if (!output[stream]) continue;
    const text = redact(output[stream], environment);
    // Generate outside the subprocess so payloads cannot resume Actions commands.
    const resume = randomBytes(32).toString('hex');
    log(
      `::stop-commands::${resume}\n[voice-benchmark] Failed Docker command ${stream}:\n${text}${text.endsWith('\n') ? '' : '\n'}::${resume}::`,
    );
  }
}
