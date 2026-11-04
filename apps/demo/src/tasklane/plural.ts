/** A count with its noun, for example `1 task` or `3 tasks`. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
