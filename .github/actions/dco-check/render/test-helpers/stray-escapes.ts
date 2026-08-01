// The characters the row scanner would consume as escaped, minus the backslash
// and pipe that `escapeCell` deliberately puts in that position. Anything else
// means a backslash from the value is still live at the block level.
export function strayEscapes(span: string): string[] {
  const stray: string[] = [];
  for (let index = 0; index < span.length; index++) {
    if (span[index] !== '\\') {
      continue;
    }
    const escaped = span[index + 1] ?? '';
    if (escaped !== '\\' && escaped !== '|') {
      stray.push(escaped);
    }
    index++;
  }
  return stray;
}
