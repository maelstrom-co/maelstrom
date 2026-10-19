import { describe, expect, test } from 'bun:test';
import {
  type DockerOutput,
  dockerOutputConsumer,
  encodeDockerOutput,
  logDockerOutput,
} from '../apps/demo/e2e/voice/docker-output.ts';

const token = 'a'.repeat(64);
const prefix = `[voice-docker-output:${token}] `;
const output = {
  stdout:
    'full stdout\nunknown error /private/path https://registry.invalid/image\n',
  stderr:
    'full stderr\r\n::error::not a workflow command\n::add-mask::not a mask',
};

function blocks(value: DockerOutput, environment: NodeJS.ProcessEnv = {}) {
  const logs: string[] = [];
  logDockerOutput(value, environment, (block) => logs.push(block));
  return logs;
}

describe('full Docker output transport', () => {
  test('round trips both streams across arbitrary splits without classifying their contents', () => {
    const received: DockerOutput[] = [];
    const consume = dockerOutputConsumer(token, (value) =>
      received.push(value),
    );
    const frame = encodeDockerOutput(output, token, {});
    for (const character of frame) consume(character);
    expect(received).toEqual([output]);
  });

  test('does not inherit lifecycle record size or count limits', () => {
    const received: DockerOutput[] = [];
    const consume = dockerOutputConsumer(token, (value) =>
      received.push(value),
    );
    const large = { stdout: 'many lines\n'.repeat(100_000), stderr: 'tail' };
    consume(encodeDockerOutput(large, token, {}));
    for (let index = 0; index < 300; index++)
      consume(encodeDockerOutput(output, token, {}));
    expect(received[0]).toEqual(large);
    expect(received).toHaveLength(301);
    expect(blocks(large)[0]).toContain(large.stdout);
  });

  test('rejects malformed, forged, and incomplete frames without forwarding unrelated child output', () => {
    const received: DockerOutput[] = [];
    const consume = dockerOutputConsumer(token, (value) =>
      received.push(value),
    );
    consume('unrelated raw stdout\n');
    consume(encodeDockerOutput(output, 'b'.repeat(64), {}));
    consume(`${prefix}{broken JSON}\n`);
    for (const invalid of [
      null,
      [output],
      { stdout: 'raw' },
      { ...output, stderr: 1 },
      { ...output, message: 'raw' },
      { ...output, token },
    ])
      consume(`${prefix}${JSON.stringify(invalid)}\n`);
    consume('x'.repeat(100_000));
    consume(encodeDockerOutput(output, token, {}));
    expect(received).toEqual([]);
    consume(encodeDockerOutput(output, token, {}));
    consume(encodeDockerOutput(output, token, {}).trimEnd());
    expect(received).toEqual([output]);
  });

  test('masks exact configured credentials before framing and again at the final sink', () => {
    const environment = {
      MAELSTROM_E2E_OPENAI_API_KEY: 'key',
      ELEVENLABS_API_KEY: 'key-longer',
      GH_TOKEN: 'github-secret',
      GITHUB_TOKEN: 'another-github-secret',
      GHCR_TOKEN: 'registry-secret',
    };
    const text = Object.values(environment).join('\n');
    const frame = encodeDockerOutput(
      { stdout: text, stderr: text },
      token,
      environment,
    );
    const received: DockerOutput[] = [];
    dockerOutputConsumer(token, (value) => received.push(value))(frame);
    const masked = Array(5).fill('[REDACTED]').join('\n');
    expect(received).toEqual([{ stdout: masked, stderr: masked }]);
    const logs = blocks({ stdout: text, stderr: text }, environment);
    for (const secret of Object.values(environment)) {
      expect(frame).not.toContain(secret);
      expect(logs.join('\n')).not.toContain(secret);
    }
    expect(logs[0]).toContain(masked);
  });

  test('wraps each complete stream with an independent unpredictable Actions stop/resume token', () => {
    const logs = blocks(output);
    expect(logs).toHaveLength(2);
    const tokens: string[] = [];
    for (const [index, stream] of ['stdout', 'stderr'].entries()) {
      const block = logs[index] ?? '';
      const resume = /^::stop-commands::([a-f0-9]{64})\n/.exec(block)?.[1];
      expect(resume).toBeDefined();
      tokens.push(resume ?? '');
      const text = output[stream as keyof DockerOutput];
      expect(block).toBe(
        `::stop-commands::${resume}\n[voice-benchmark] Failed Docker command ${stream}:\n${text}${text.endsWith('\n') ? '' : '\n'}::${resume}::`,
      );
      expect(resume).not.toBe(token);
    }
    expect(new Set(tokens).size).toBe(2);
    expect(blocks({ stdout: '', stderr: '' })).toEqual([]);
  });
});
