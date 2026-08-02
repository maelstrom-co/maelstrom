export function backtickCount(value: string): number {
  return value.split('`').length - 1;
}
