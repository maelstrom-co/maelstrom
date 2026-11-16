export function markdownPath(pathname: string): string {
  return `${pathname.replace(/\/$/, '') || '/index'}.md`;
}
