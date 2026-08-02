export function tableRows(body: string): string[] {
  return body.split('\n').filter((line) => line.startsWith('| `'));
}
