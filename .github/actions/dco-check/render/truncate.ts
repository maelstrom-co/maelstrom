// Callers truncate the raw value and escape the result, never the other way
// round: `escapeCell` doubles backslashes, so slicing its output can leave a
// trailing lone backslash, which escapes the span's closing backtick and lets
// the value out of the span the escaping put it in. Escaping after truncating
// can only double the bound, which is what the limits allow for.
//
// Sliced by code point rather than by UTF-16 unit so a cut cannot land inside a
// surrogate pair and emit a lone surrogate.
export function truncate(value: string, limit: number): string {
  const points = Array.from(value);
  return points.length <= limit ? value : `${points.slice(0, limit).join('')}…`;
}
