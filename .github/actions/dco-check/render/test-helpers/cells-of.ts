// Split on cell boundaries only — a `\|` inside a cell is content, not a
// boundary, which is exactly what the escaping is supposed to guarantee.
export function cellsOf(row: string): string[] {
  return row.split(/(?<!\\)\|/).slice(1, -1);
}
