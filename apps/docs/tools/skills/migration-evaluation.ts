import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export async function migrationSnapshot(
  directory: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let bytes = 0;
  let files = 0;
  const pending: Array<{ path: string; name: string }> = [];
  async function visit(dir: string, prefix: string) {
    if (!(await lstat(dir)).isDirectory())
      throw new Error('Symlinks and non-directory roots are not accepted');
    const entries = (await readdir(dir)).sort();
    for (let index = 0; index < entries.length; index += 16) {
      const batch = entries.slice(index, index + 16);
      const stats = await Promise.allSettled(
        batch.map((entry) => lstat(join(dir, entry))),
      );
      for (const [offset, entry] of batch.entries()) {
        const path = join(dir, entry);
        const name = prefix + entry;
        const info = stats[offset];
        if (info.status === 'rejected') throw info.reason;
        const stat = info.value;
        if (stat.isSymbolicLink())
          throw new Error('Symlinks are not accepted in migration evidence');
        if (stat.isDirectory()) await visit(path, `${name}/`);
        else if (stat.isFile()) {
          bytes += stat.size;
          files++;
          if (
            stat.size > 128_000_000 ||
            bytes > 1_000_000_000 ||
            files > 50_000
          )
            throw new Error('Evidence size limit');
          pending.push({ path, name });
        } else throw new Error('Nonregular migration evidence');
      }
    }
  }
  await visit(directory, '');
  for (let index = 0; index < pending.length; index += 8) {
    const batch = pending.slice(index, index + 8);
    const hashes = await Promise.allSettled(
      batch.map(async (file) =>
        createHash('sha256')
          .update(await readFile(file.path))
          .digest('hex'),
      ),
    );
    for (const [offset, file] of batch.entries()) {
      const hash = hashes[offset];
      if (hash.status === 'rejected') throw hash.reason;
      result[file.name] = hash.value;
    }
  }
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

type Usage = {
  uncachedInput: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  source: 'reported-tokens-not-billing';
};

export function parsePiUsage(text: string): Usage | null {
  if (Buffer.byteLength(text) > 8_000_000) throw new Error('Trace size limit');
  const total: Usage = {
    uncachedInput: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    source: 'reported-tokens-not-billing',
  };
  let count = 0;
  let incomplete = false;
  const formats = new Set<string>();
  for (const line of text.split('\n').filter(Boolean)) {
    if (line.length > 1_000_000) throw new Error('Trace record size limit');
    const row = JSON.parse(line);
    if (!row || typeof row !== 'object')
      throw new Error('Invalid trace record');
    if (
      !['message', 'message_end'].includes(row.type) ||
      row.message?.role !== 'assistant'
    )
      continue;
    formats.add(row.type);
    if (formats.size > 1)
      throw new Error('Mixed Pi trace formats would double count usage');
    const usage = row.message.usage;
    if (!usage) {
      incomplete = true;
      continue;
    }
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
      if (!Number.isSafeInteger(usage[key]) || usage[key] < 0)
        throw new Error('Invalid token usage');
    }
    total.uncachedInput += usage.input;
    total.output += usage.output;
    total.cacheRead += usage.cacheRead;
    total.cacheWrite += usage.cacheWrite;
    count++;
  }
  if (
    Object.values(total).some(
      (value) => typeof value === 'number' && !Number.isSafeInteger(value),
    )
  )
    throw new Error('Token total overflow');
  return count && !incomplete ? total : null;
}

export type PiBinding = {
  cwd: string;
  prompt: string;
  guides: Record<
    string,
    { heading: string; content: string; kind: 'migration' | 'sdk' }
  >;
};

function validStartupSections(sections: unknown): boolean {
  if (!sections || typeof sections !== 'object' || Array.isArray(sections))
    return false;
  const known = new Set([
    'preamble',
    'tools',
    'rules',
    'docs',
    'project_context',
    'skills',
    'cwd',
  ]);
  const entries = Object.entries(sections);
  let bytes = 0;
  for (const [key, value] of entries) {
    if (!known.has(key) || typeof value !== 'string' || !value.trim())
      return false;
    const size = Buffer.byteLength(value);
    bytes += size;
    if (size > 262_144 || bytes > 900_000) return false;
  }
  return ['preamble', 'skills', 'cwd'].every((key) =>
    entries.some(([name]) => name === key),
  );
}

export function piEvidence(text: string, binding?: PiBinding) {
  const empty = {
    usage: null as Usage | null,
    model: null as string | null,
    activated: false,
    sdkGuidesReceived: [] as string[],
    traceBound: false,
    sessionId: null as string | null,
    traceStatus: 'unbound',
    guideExposure: false,
  };
  try {
    const usage = parsePiUsage(text);
    const rows = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const models = new Set<string>();
    const formats = new Set<string>();
    const sessions = rows.filter((row) => row.type === 'session');
    const headersValid =
      sessions.length === 1 &&
      rows[0] === sessions[0] &&
      typeof sessions[0].id === 'string' &&
      /^[\w-]{8,128}$/.test(sessions[0].id) &&
      Number.isSafeInteger(sessions[0].version) &&
      sessions[0].version > 0 &&
      typeof sessions[0].cwd === 'string';
    let valid = Boolean(
      binding &&
        headersValid &&
        resolve(sessions[0].cwd) === resolve(binding.cwd),
    );
    const contentText = (content: unknown): string => {
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return '';
      return content
        .filter(
          (item) => item?.type === 'text' && typeof item.text === 'string',
        )
        .map((item) => item.text)
        .join('\n');
    };
    const normal = (value: string) => value.replaceAll('\r\n', '\n').trim();
    const reads = new Map<string, string>();
    const receipts = new Set<string>();
    let guideExposure = false;
    const entryIds = new Set<string>();
    let previousEntry: string | null = null;
    let userCount = 0;
    let starts = 0;
    let ends = 0;
    let final:
      | { role?: string; stopReason?: string; content?: unknown }
      | undefined;
    const registerRead = (id: unknown, path: unknown) => {
      if (
        typeof id !== 'string' ||
        typeof path !== 'string' ||
        path.length > 4096 ||
        !binding
      )
        return;
      const absolute = resolve(binding.cwd, path);
      if (
        path.endsWith('SKILL.md') &&
        !absolute.startsWith(`${resolve(binding.cwd)}${sep}`)
      )
        valid = false;
      if (reads.has(id) && reads.get(id) !== absolute) valid = false;
      reads.set(id, absolute);
    };
    const receive = (
      id: unknown,
      result: { isError?: unknown; content?: unknown } | undefined,
      isError: unknown,
    ) => {
      if (
        typeof id !== 'string' ||
        isError !== false ||
        result?.isError === true ||
        !binding
      )
        return;
      const path = reads.get(id);
      const expected = path ? binding.guides[path] : undefined;
      const delivered = normal(contentText(result?.content));
      if (
        path &&
        expected &&
        expected.content.length > 20 &&
        delivered.includes(expected.heading) &&
        delivered.includes(expected.content)
      ) {
        receipts.add(path);
        guideExposure = true;
      }
    };
    for (const row of rows) {
      if (row.type === 'agent_start') starts++;
      if (row.type === 'agent_end') ends++;
      if (row.type === 'message') {
        if (
          typeof row.id !== 'string' ||
          entryIds.has(row.id) ||
          row.parentId !== previousEntry
        )
          valid = false;
        entryIds.add(row.id);
        previousEntry = row.id;
      } else if (typeof row.id === 'string' && row.type !== 'session') {
        if (entryIds.has(row.id) || row.parentId !== previousEntry)
          valid = false;
        entryIds.add(row.id);
        previousEntry = row.id;
      }
      if (row.type === 'tool_execution_start' && row.toolName === 'read')
        registerRead(row.toolCallId, row.args?.path);
      if (row.type === 'tool_execution_end')
        receive(row.toolCallId, row.result, row.isError);
      if (!['message', 'message_end'].includes(row.type)) continue;
      formats.add(row.type);
      if (ends) valid = false;
      const message = row.message;
      if (!message || typeof message !== 'object') {
        valid = false;
        continue;
      }
      if (message.role === 'system') {
        if (
          typeof message.sections?.skills === 'string' &&
          /maelstrom-react-(?:migration|sdk)/.test(message.sections.skills)
        )
          guideExposure = true;
        if (
          !normal(contentText(message.content)) &&
          !validStartupSections(message.sections)
        )
          valid = false;
        continue;
      }
      final = message;
      if (message.role === 'user') {
        userCount++;
        if (
          !binding ||
          normal(contentText(message.content)) !== normal(binding.prompt)
        )
          valid = false;
        if (
          Array.isArray(message.content) &&
          message.content.some(
            (item: { type?: unknown; text?: unknown }) =>
              item?.type !== 'text' || typeof item.text !== 'string',
          )
        )
          valid = false;
      }
      if (message.role === 'assistant') {
        if (
          typeof message.model === 'string' &&
          /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(message.model) &&
          typeof message.provider === 'string' &&
          /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(message.provider)
        )
          models.add(`${message.provider}/${message.model}`);
        else models.add('');
        if (['error', 'aborted', 'length'].includes(message.stopReason))
          valid = false;
        if (Array.isArray(message.content))
          for (const item of message.content)
            if (item?.type === 'toolCall' && item.name === 'read')
              registerRead(item.id, item.arguments?.path);
      }
      if (message.role === 'toolResult')
        receive(message.toolCallId, message, message.isError);
    }
    const streamed = formats.has('message_end');
    valid &&=
      formats.size === 1 &&
      userCount === 1 &&
      final?.role === 'assistant' &&
      final.stopReason === 'stop' &&
      normal(contentText(final.content)).length > 0;
    const settlements = rows.filter((row) => row.type === 'agent_settled');
    const terminalEnd =
      settlements.length === 0
        ? rows.at(-1)?.type === 'agent_end'
        : settlements.length === 1 &&
          rows.at(-1) === settlements[0] &&
          Object.keys(settlements[0]).length === 1 &&
          rows.at(-2)?.type === 'agent_end';
    if (streamed) valid &&= starts === 1 && ends === 1 && terminalEnd;
    else valid &&= starts === 0 && ends === 0 && settlements.length === 0;
    if (
      Array.isArray(final?.content) &&
      final.content.some((item) => item?.type === 'toolCall')
    )
      valid = false;
    const activated = Boolean(
      binding &&
        [...receipts].some((path) => binding.guides[path].kind === 'migration'),
    );
    return {
      usage,
      model: models.size === 1 && !models.has('') ? [...models][0] : null,
      activated,
      sdkGuidesReceived: binding
        ? [...receipts]
            .filter((path) => binding.guides[path].kind === 'sdk')
            .map((path) => path.slice(resolve(binding.cwd).length + 1))
        : [],
      traceBound: valid,
      sessionId: headersValid
        ? createHash('sha256').update(sessions[0].id).digest('hex')
        : null,
      traceStatus: valid ? 'bound' : 'unbound',
      guideExposure,
    };
  } catch {
    return { ...empty, traceStatus: 'invalid' };
  }
}

export type MigrationCompareInput = {
  model: string | null;
  activated: boolean;
  passed: boolean;
  usage: Usage | null;
  traceBound?: boolean;
  sessionId?: string | null;
  sdkGuidesReceived?: readonly string[];
  guideExposure?: boolean;
  reviewApproved?: boolean;
  reviewHash?: string | null;
};

export function compareMigration(
  baseline: MigrationCompareInput,
  treatment: MigrationCompareInput,
) {
  const eligible = Boolean(
    baseline.model &&
      baseline.traceBound &&
      treatment.traceBound &&
      baseline.sessionId &&
      treatment.sessionId &&
      baseline.sessionId !== treatment.sessionId &&
      baseline.model === treatment.model &&
      !baseline.activated &&
      baseline.guideExposure === false &&
      baseline.sdkGuidesReceived?.length === 0 &&
      treatment.activated &&
      treatment.sdkGuidesReceived?.some(
        (path) =>
          path ===
            'node_modules/@maelstrom-co/react/skills/maelstrom-react-sdk/SKILL.md' ||
          path === 'vendor/react/skills/maelstrom-react-sdk/SKILL.md',
      ) &&
      baseline.reviewApproved &&
      treatment.reviewApproved &&
      baseline.reviewHash &&
      baseline.reviewHash === treatment.reviewHash &&
      baseline.passed &&
      treatment.passed &&
      baseline.usage &&
      treatment.usage,
  );
  return {
    eligible,
    savings:
      eligible && baseline.usage && treatment.usage
        ? {
            uncachedInputTokens:
              baseline.usage.uncachedInput - treatment.usage.uncachedInput,
            outputTokens: baseline.usage.output - treatment.usage.output,
            cacheReadTokens:
              baseline.usage.cacheRead - treatment.usage.cacheRead,
            cacheWriteTokens:
              baseline.usage.cacheWrite - treatment.usage.cacheWrite,
            billing: null,
          }
        : null,
  };
}
