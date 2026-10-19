const phases = [
  'initialization',
  'context',
  'claim',
  'claim-monitor',
  'credentials',
  'benchmark',
  'fixtures',
  'docker-build',
  'docker-create',
  'docker-start',
  'artifacts',
  'tests',
  'attachments',
  'metrics',
  'publication',
  'cleanup',
] as const;
const categories = [
  'started',
  'completed',
  'ineligible',
  'already-claimed',
  'missing-credential',
  'invalid-run-id',
  'claim-not-persisted',
  'claim-lost',
  'claim-check-failed',
  'spawn-failed',
  'nonzero-exit',
  'signal-exit',
  'cancelled',
  'deadline-exceeded',
  'metrics-missing',
  'metrics-invalid',
  'test-failed',
  'test-retried',
  'attachment-invalid',
  'metrics-incomplete',
  'cleanup-failed',
  'unexpected-error',
] as const;
const credentials = [
  'MAELSTROM_E2E_OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
] as const;
const signals = [
  'SIGINT',
  'SIGTERM',
  'SIGKILL',
  'SIGABRT',
  'SIGSEGV',
  'SIGBUS',
  'SIGILL',
  'SIGFPE',
  'SIGPIPE',
  'SIGHUP',
  'SIGQUIT',
  'SIGUSR1',
  'SIGUSR2',
  'SIGALRM',
  'SIGXCPU',
  'SIGXFSZ',
  'SIGSYS',
  'SIGTRAP',
  'SIGVTALRM',
  'SIGPROF',
] as const;
const prefix = '[voice-benchmark] ';

export type VoiceDiagnostic = {
  readonly phase: (typeof phases)[number];
  readonly category: (typeof categories)[number];
  readonly credential?: (typeof credentials)[number];
  readonly exitCode?: number;
  readonly signal?: string;
};

function validateDiagnostic(value: unknown): VoiceDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        !['phase', 'category', 'credential', 'exitCode', 'signal'].includes(
          key,
        ),
    ) ||
    !phases.some((phase) => phase === record.phase) ||
    !categories.some((category) => category === record.category) ||
    (record.credential !== undefined &&
      !credentials.some((name) => name === record.credential)) ||
    (record.exitCode !== undefined &&
      (typeof record.exitCode !== 'number' ||
        !Number.isInteger(record.exitCode) ||
        record.exitCode < 0 ||
        record.exitCode > 255)) ||
    (record.signal !== undefined &&
      !signals.some((signal) => signal === record.signal))
  )
    return;
  return {
    phase: record.phase as VoiceDiagnostic['phase'],
    category: record.category as VoiceDiagnostic['category'],
    ...(record.credential !== undefined
      ? { credential: record.credential as VoiceDiagnostic['credential'] }
      : {}),
    ...(record.exitCode !== undefined
      ? { exitCode: record.exitCode as number }
      : {}),
    ...(record.signal !== undefined ? { signal: record.signal as string } : {}),
  };
}

export function logVoiceDiagnostic(
  event: VoiceDiagnostic,
  log: (line: string) => void = console.log,
): void {
  const safe = validateDiagnostic(event);
  if (safe) log(`${prefix}${JSON.stringify(safe)}`);
}

// Child stdout may contain provider payloads. Only complete, bounded, exact-schema
// records may cross into Actions logs; there is deliberately no raw fallback.
export function voiceDiagnosticConsumer(
  log?: (line: string) => void,
): (chunk: string) => void {
  let pending = '';
  let dropping = false;
  let emitted = 0;
  return (chunk) => {
    if (emitted >= 256) return;
    let start = 0;
    while (start < chunk.length && emitted < 256) {
      const end = chunk.indexOf('\n', start);
      const part = chunk.slice(start, end < 0 ? chunk.length : end);
      if (!dropping && pending.length + part.length <= 512) pending += part;
      else {
        pending = '';
        dropping = true;
      }
      if (end < 0) return;
      if (!dropping && pending.startsWith(prefix)) {
        try {
          const event = validateDiagnostic(
            JSON.parse(pending.slice(prefix.length)),
          );
          if (event) {
            logVoiceDiagnostic(event, log);
            emitted++;
          }
        } catch {
          // Malformed records are untrusted output, not diagnostic errors.
        }
      }
      pending = '';
      dropping = false;
      start = end + 1;
    }
  };
}
