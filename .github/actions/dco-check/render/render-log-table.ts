import type { Verdict } from '../policy/verdict.ts';
import { code } from './code.ts';
import { detail } from './detail.ts';
import { identityCell } from './identity-cell.ts';
import { row } from './row.ts';
import { shortSha } from './short-sha.ts';

export function renderLogTable(verdicts: Verdict[]): string {
  return [
    row(['Commit', 'Author', 'Verdict', 'Detail']),
    row(['---', '---', '---', '---']),
    ...verdicts.map((verdict) =>
      row([
        code(shortSha(verdict.commit)),
        identityCell(verdict.commit),
        verdict.state,
        detail(verdict),
      ]),
    ),
  ].join('\n');
}
