import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIL_DIRECTORY = import.meta.dirname;

describe('mail bundle boundary', () => {
  it('never imports the main demo Maelstrom instance', () => {
    const offenders = sourceFiles(MAIL_DIRECTORY).filter((file) =>
      /from\s+['"](?:\.\.\/)+lib\/maelstrom['"]/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the stores free of the mail Maelstrom instance', () => {
    const offenders = sourceFiles(join(MAIL_DIRECTORY, 'stores')).filter(
      (file) =>
        /from\s+['"]\.\.\/maelstrom['"]/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
