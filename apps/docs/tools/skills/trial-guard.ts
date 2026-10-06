import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';

interface TrialToolCall {
  toolName: string;
  input: Record<string, unknown>;
}

interface TrialExtension {
  on(
    event: 'tool_call',
    handler: (
      event: TrialToolCall,
      context: { cwd: string },
    ) => { block: true; reason: string } | undefined,
  ): void;
}

export default function guard(pi: TrialExtension): void {
  pi.on('tool_call', (event, context) => {
    if (!['read', 'grep', 'find', 'ls'].includes(event.toolName)) {
      return {
        block: true,
        reason:
          'Plan-only inspection does not authorize mutations or shell operations.',
      };
    }
    const root = realpathSync(context.cwd);
    if (['read', 'grep', 'find', 'ls'].includes(event.toolName)) {
      const requested =
        typeof event.input.path === 'string' ? event.input.path : '.';
      if (
        requested.startsWith('@') ||
        /^[a-z][a-z\d+.-]*:/i.test(requested) ||
        requested.includes('\\')
      ) {
        return {
          block: true,
          reason: 'Use a plain filesystem path inside the consumer.',
        };
      }
      const expanded =
        requested === '~'
          ? homedir()
          : requested.startsWith('~/')
            ? resolve(homedir(), requested.slice(2))
            : requested;
      const path = resolve(root, expanded);
      if (path !== root && !path.startsWith(`${root}${sep}`)) {
        return {
          block: true,
          reason: 'Use only files inside this consumer project.',
        };
      }
      let current = path;
      while (current !== root) {
        try {
          if (lstatSync(current).isSymbolicLink())
            return {
              block: true,
              reason: 'Symlinks are not permitted in this isolated trial.',
            };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            return {
              block: true,
              reason: 'The requested path could not be verified.',
            };
        }
        current = dirname(current);
      }
      if (containsSymlink(path))
        return {
          block: true,
          reason: 'Recursive inspection may not traverse symlinks.',
        };
    }
    return undefined;
  });
}

function containsSymlink(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return true;
    return (
      stat.isDirectory() &&
      readdirSync(path).some((name) => containsSymlink(resolve(path, name)))
    );
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}
