// Models the rule cmark-gfm splits rows by, at the block level and before any
// inline parsing: walk the row, and on a backslash step over the next character
// whatever it is, so only a pipe the walk lands on is a cell boundary. A regex
// cannot state this — whether a pipe is a boundary depends on the parity of the
// backslash run in front of it, and a lookbehind reads a fixed width, so it
// mistakes the second backslash of a `\\` pair for an escape and reports a row
// intact exactly where GFM would tear it apart.
export function cellsOf(row: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < row.length; index++) {
    if (row[index] === '\\') {
      cell += row.slice(index, index + 2);
      index++;
      continue;
    }
    if (row[index] === '|') {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += row[index];
  }
  cells.push(cell);
  // A row opens and closes with a pipe, so the first and last segments are the
  // empty text outside the table, not cells.
  return cells.slice(1, -1);
}
