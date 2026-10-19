import { describe, expect, test } from 'bun:test';
import {
  logVoiceDiagnostic,
  type VoiceDiagnostic,
  voiceDiagnosticConsumer,
} from '../apps/demo/e2e/voice/ci-diagnostics.ts';
import {
  classifyDockerFailure,
  dockerDiagnosticOperation,
} from '../apps/demo/e2e/voice/docker-diagnostics.ts';

const secret = 'sensitive-token-path-transcript';
const cases = [
  [
    `Cannot connect to the Docker daemon at unix:///private/${secret}.sock. Is the docker daemon running?`,
    'daemon-unavailable',
  ],
  [
    `permission denied while trying to connect to the Docker daemon socket at unix:///private/${secret}`,
    'daemon-unavailable',
  ],
  [
    `error during connect: Get "http://${secret}/v1.45/info": dial tcp: connection refused`,
    'daemon-unavailable',
  ],
  [
    `docker: Error response from daemon: unauthorized: authentication required ${secret}`,
    'registry-auth',
  ],
  [
    `Error response from daemon: Get "https://ghcr.io/v2/${secret}/manifests/tag": denied: denied`,
    'registry-auth',
  ],
  [
    `docker: Error response from daemon: denied: requested access to the resource is denied ${secret}`,
    'registry-auth',
  ],
  [
    `Error response from daemon: manifest for registry/${secret}:tag not found: manifest unknown`,
    'image-unavailable',
  ],
  [
    'Error response from daemon: no matching manifest for linux/amd64 in the manifest list entries',
    'image-unavailable',
  ],
  [
    `Error response from daemon: Get "https://registry.invalid/v2/${secret}": dial tcp: lookup registry.invalid: no such host`,
    'registry-network',
  ],
  [
    `Error response from daemon: Head "https://registry.invalid/v2/${secret}": net/http: TLS handshake timeout`,
    'registry-network',
  ],
  [
    `docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /private/${secret}`,
    'mount-configuration',
  ],
  [
    `Error response from daemon: failed to create task for container: OCI runtime create failed: error mounting "/private/${secret}"`,
    'mount-configuration',
  ],
  [
    `Error response from daemon: failed to create task for container: OCI runtime create failed: no space left on device: /private/${secret}`,
    'resource-exhausted',
  ],
  [
    `Error response from daemon: cannot allocate memory ${secret}`,
    'resource-exhausted',
  ],
  [
    `Error response from daemon: OCI runtime create failed: runc create failed: ${secret}`,
    'runtime-start',
  ],
  [
    `Error response from daemon: Get "https://registry.invalid/v2/${secret}": x509: certificate signed by unknown authority`,
    'registry-network',
  ],
] as const;

const dockerEvent = {
  phase: 'fixtures',
  category: 'docker-failed',
  exitCode: 125,
  dockerOperation: 'run',
  dockerFailure: 'unclassified',
} as const;

function roundTrip(event: VoiceDiagnostic): string[] {
  const logs: string[] = [];
  const consume = voiceDiagnosticConsumer((line) => logs.push(line));
  logVoiceDiagnostic(event, (line) => consume(`${line}\n`));
  return logs;
}

describe('Docker stderr classification', () => {
  for (const [stderr, hint] of cases) {
    test(`returns only ${hint} for ${stderr.split(':')[0]}`, () => {
      const failure = classifyDockerFailure(stderr);
      expect(failure).toBe(hint);
      const logs = roundTrip({ ...dockerEvent, dockerFailure: failure });
      expect(logs).toEqual([
        `[voice-benchmark] ${JSON.stringify({ ...dockerEvent, dockerFailure: hint })}`,
      ]);
      expect(logs.join('')).not.toContain(secret);
    });
  }

  test('does not infer a cause from empty, ambiguous, or arbitrary application output', () => {
    for (const stderr of [
      '',
      secret,
      'exit 125',
      'permission denied',
      'unauthorized: authentication required',
      'no space left on device',
      `Error response from daemon: pull access denied for ${secret}, repository does not exist or may require 'docker login'`,
      `Error response from daemon: Get "https://provider.invalid/${secret}": dial tcp: connection refused`,
      `${cases[0][0]}\n${cases[3][0]}`,
      `::error::${secret}\n\u001b[31m${secret}`,
    ]) {
      expect(classifyDockerFailure(stderr)).toBe('unclassified');
    }
  });

  test('does not classify URL or path payloads as error clauses', () => {
    expect(
      classifyDockerFailure(
        'Error response from daemon: Get "https://ghcr.io/v2/x509/manifests/latest": unexpected status code 500',
      ),
    ).toBe('unclassified');
    for (const path of [
      `/private/no space left on device/${secret}`,
      `/private/${secret}: no space left on device`,
      `"/private/${secret}: out of memory"`,
    ]) {
      const failure = classifyDockerFailure(
        `Error response from daemon: invalid mount config for type "bind": bind source path does not exist: ${path}`,
      );
      expect(failure).toBe('mount-configuration');
      expect(
        roundTrip({ ...dockerEvent, dockerFailure: failure }).join(''),
      ).not.toContain(secret);
    }
  });

  test('conflicting specific clauses are unclassified, while OCI wrappers can be refined', () => {
    for (const detail of [
      'invalid mount config for type "bind": no space left on device',
      'no space left on device: invalid mount config for type "bind"',
      'OCI runtime create failed: invalid mount config for type "bind": no space left on device',
      'Get "https://ghcr.io/v2/image/manifests/latest": unauthorized: authentication required: i/o timeout',
    ])
      expect(
        classifyDockerFailure(`Error response from daemon: ${detail}`),
      ).toBe('unclassified');
    expect(
      classifyDockerFailure(
        'Error response from daemon: OCI runtime create failed: runc create failed: no space left on device',
      ),
    ).toBe('resource-exhausted');
  });

  test('limits inspection and ignores a partially truncated error line', () => {
    const message = cases[0][0];
    expect(classifyDockerFailure(`${'x'.repeat(16_384)}\n${message}`)).toBe(
      'unclassified',
    );
    expect(classifyDockerFailure(`${'x'.repeat(16_300)}\n${message}`)).toBe(
      'unclassified',
    );
    expect(classifyDockerFailure(`${message}\n${'x'.repeat(100_000)}`)).toBe(
      'daemon-unavailable',
    );
  });

  test('maps only known command verbs and never includes arguments', () => {
    for (const operation of [
      'run',
      'build',
      'create',
      'start',
      'cp',
      'logs',
      'rm',
    ] as const)
      expect(dockerDiagnosticOperation([operation, secret])).toBe(operation);
    expect(dockerDiagnosticOperation(['image', 'rm', secret])).toBe('image-rm');
    expect(dockerDiagnosticOperation(['image', secret])).toBe('other');
    expect(dockerDiagnosticOperation([secret])).toBe('other');
    expect(dockerDiagnosticOperation([])).toBe('other');
  });
});

describe('Docker diagnostic schema', () => {
  test('accepts all enum fields and preserves the canonical record through chunking', () => {
    for (const dockerOperation of [
      'run',
      'build',
      'create',
      'start',
      'cp',
      'logs',
      'rm',
      'image-rm',
      'other',
    ] as const)
      expect(roundTrip({ ...dockerEvent, dockerOperation })).toHaveLength(1);
    expect(roundTrip(dockerEvent)).toHaveLength(1);
    const logs: string[] = [];
    const consume = voiceDiagnosticConsumer((line) => logs.push(line));
    const record = `[voice-benchmark] ${JSON.stringify(dockerEvent)}\n`;
    consume(record.slice(0, 120));
    consume(record.slice(120));
    expect(logs).toEqual([record.trimEnd()]);
  });

  test('rejects unknown enums, raw fields, missing details and details on other categories', () => {
    for (const event of [
      { ...dockerEvent, dockerOperation: secret },
      { ...dockerEvent, dockerFailure: secret },
      { ...dockerEvent, dockerFailure: null },
      { ...dockerEvent, dockerOperation: undefined },
      { ...dockerEvent, dockerFailure: undefined },
      { ...dockerEvent, category: 'nonzero-exit' },
      { ...dockerEvent, stderr: secret },
      { ...dockerEvent, args: [secret] },
      { ...dockerEvent, message: secret },
    ]) {
      expect(roundTrip(event as unknown as VoiceDiagnostic)).toEqual([]);
      const logs: string[] = [];
      voiceDiagnosticConsumer((line) => logs.push(line))(
        `[voice-benchmark] ${JSON.stringify(event)}\n`,
      );
      expect(logs).toEqual([]);
    }
  });
});
