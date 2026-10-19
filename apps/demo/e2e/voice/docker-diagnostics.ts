import type { VoiceDiagnostic } from './ci-diagnostics.ts';

type DockerFailure = NonNullable<VoiceDiagnostic['dockerFailure']>;
type DockerOperation = NonNullable<VoiceDiagnostic['dockerOperation']>;

export function dockerDiagnosticOperation(
  args: readonly string[],
): DockerOperation {
  switch (args[0]) {
    case 'run':
    case 'build':
    case 'create':
    case 'start':
    case 'cp':
    case 'logs':
    case 'rm':
      return args[0];
    case 'image':
      return args[1] === 'rm' ? 'image-rm' : 'other';
    default:
      return 'other';
  }
}

function classifyLine(line: string): DockerFailure | undefined {
  const message = line.trim().replace(/^docker: /i, '');
  if (
    /^(?:cannot connect to the docker daemon\b|error during connect:|permission denied while trying to connect to the docker daemon socket\b)/i.test(
      message,
    )
  )
    return 'daemon-unavailable';
  if (!/^error response from daemon:/i.test(message)) return;

  let detail = message.replace(/^error response from daemon:\s*/i, '');
  const request =
    /^(?:get|head) "https?:\/\/[^"\s]+\/v2\/[^"\r\n]*":\s*(.*)$/i.exec(detail);
  if (request) detail = request[1] ?? '';
  // Quoted values and terminal path payloads are not error clauses. Follow only
  // recognized clauses; otherwise a URL/path can masquerade as a second cause.
  const clauses = detail
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
    .split(/:\s+/);
  const matches = new Set<DockerFailure>();
  let runtime = false;
  for (let index = 0; index < clauses.length; index++) {
    const clause = clauses[index]?.trim() ?? '';
    if (
      /^(?:no space left on device|disk quota exceeded|cannot allocate memory|out of memory)\b/i.test(
        clause,
      )
    ) {
      matches.add('resource-exhausted');
    } else if (
      /^(?:invalid volume specification|bind source path does not exist)\b/i.test(
        clause,
      )
    ) {
      matches.add('mount-configuration');
      break;
    } else if (/^(?:invalid mount config|error mounting)\b/i.test(clause)) {
      matches.add('mount-configuration');
    } else if (
      (/^unauthorized$/i.test(clause) &&
        /^authentication required\b|^incorrect username or password\b/i.test(
          clauses[index + 1] ?? '',
        )) ||
      (/^denied$/i.test(clause) &&
        (/^requested access to the resource is denied\b/i.test(
          clauses[index + 1] ?? '',
        ) ||
          (request && /^denied$/i.test(clauses[index + 1] ?? ''))))
    ) {
      matches.add('registry-auth');
      index++;
    } else if (
      /^(?:manifest unknown\b|manifest for \S+ not found$|no matching manifest for \S+ in the manifest list entries$)/i.test(
        clause,
      )
    ) {
      matches.add('image-unavailable');
    } else if (
      request &&
      /^(?:dial tcp\b|i\/o timeout\b|tls handshake timeout\b|x509$|no such host\b|connection refused\b|context deadline exceeded\b|client\.timeout exceeded\b)/i.test(
        clause,
      )
    ) {
      matches.add('registry-network');
    } else if (
      /^(?:oci runtime (?:create|start|exec) failed|failed to create task for container)$/i.test(
        clause,
      )
    ) {
      runtime = true;
    } else if (
      !/^runc (?:create|start|exec) failed$/i.test(clause) &&
      !(request && /^net\/http$/i.test(clause))
    ) {
      break;
    }
  }
  // Specific clauses can refine an OCI wrapper, but never override each other.
  if (matches.size > 1) return 'unclassified';
  return (
    matches.values().next().value ?? (runtime ? 'runtime-start' : undefined)
  );
}

// Docker stderr may include application output; these are hints, not trusted
// root causes. Inspect a bounded prefix, never return any of the matched text.
export function classifyDockerFailure(stderr: string): DockerFailure {
  const prefix = stderr.slice(0, 16_384);
  const complete =
    stderr.length > prefix.length
      ? prefix.slice(0, prefix.lastIndexOf('\n') + 1)
      : prefix;
  const matches = new Set<DockerFailure>();
  for (const line of complete.split('\n')) {
    const failure = classifyLine(line);
    if (failure) matches.add(failure);
  }
  return matches.size === 1
    ? (matches.values().next().value ?? 'unclassified')
    : 'unclassified';
}
