export const narrationVersion = 2;

const skip =
  'pre, script, style, template, noscript, svg, math, video, audio, iframe, [hidden], [aria-hidden="true"], [data-narration-skip], .sr-only, .hidden, .invisible';
const paragraphs =
  'address, article, aside, audio, blockquote, br, dd, details, div, dl, dt, figcaption, figure, h1, h2, h3, h4, h5, h6, hr, iframe, li, ol, p, pre, section, summary, table, td, th, ul, video';

interface Point {
  node: Text;
  offset: number;
}

export function extractNarration(document: Document) {
  const points: (Point | undefined)[] = [];
  let text = '';
  let separator = '';

  function visit(node: Node) {
    if (node.nodeType === 3) {
      const content = node as Text;
      for (let offset = 0; offset < content.length; offset++) {
        const character = content.data[offset];
        if (/\s/u.test(character)) {
          separator ||= ' ';
          continue;
        }
        if (text && separator) {
          text += separator;
          for (let index = 0; index < separator.length; index++)
            points.push(undefined);
        }
        separator = '';
        text += character;
        points.push({ node: content, offset });
      }
    } else if (node.nodeType === 1) {
      const element = node as HTMLElement;
      const boundary = element.matches(paragraphs);
      if (boundary) separator = '\n\n';
      if (
        !element.matches(skip) &&
        element.style?.display !== 'none' &&
        element.style?.visibility !== 'hidden'
      ) {
        for (const child of element.childNodes) visit(child);
      }
      if (boundary) separator = '\n\n';
    }
  }

  for (const section of document.querySelectorAll('[data-narration-text]')) {
    separator = '\n\n';
    visit(section);
  }

  return {
    text,
    range(from: number, to: number) {
      const first = points[from];
      const last = points[to - 1];
      if (!first || !last) return;
      const range = document.createRange();
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, last.offset + 1);
      return range;
    },
  };
}

export async function narrationDigest(value: string | Uint8Array<ArrayBuffer>) {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export interface WordTiming {
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface NarrationChunk {
  duration: number;
  sha256: string;
  words: WordTiming[];
}

export interface NarrationManifest {
  version: string;
  textHash: string;
  chunks: NarrationChunk[];
}

const digestPattern = /^[a-f0-9]{64}$/u;

export function validateTiming(
  value: unknown,
  text: string,
): value is NarrationChunk {
  if (typeof value !== 'object' || value === null) return false;
  const { duration, sha256, words } = value as NarrationChunk;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    typeof sha256 !== 'string' ||
    !digestPattern.test(sha256) ||
    !Array.isArray(words)
  )
    return false;
  let previousOffset = 0;
  let previousEnd = 0;
  for (const entry of words) {
    if (!entry || typeof entry !== 'object') return false;
    const { from, to, start, end } = entry as WordTiming;
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < previousOffset ||
      to <= from ||
      to > text.length ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < previousEnd ||
      end <= start ||
      end > duration
    )
      return false;
    previousOffset = to;
    previousEnd = end;
  }
  return true;
}

export function validateManifest(
  value: unknown,
  text: string,
): value is NarrationManifest {
  if (typeof value !== 'object' || value === null) return false;
  const { version, textHash, chunks } = value as NarrationManifest;
  if (
    typeof version !== 'string' ||
    !digestPattern.test(version) ||
    typeof textHash !== 'string' ||
    !digestPattern.test(textHash) ||
    !Array.isArray(chunks) ||
    chunks.length === 0
  )
    return false;
  let previousOffset = 0;
  for (const chunk of chunks) {
    if (!validateTiming(chunk, text)) return false;
    for (const word of chunk.words) {
      if (word.from < previousOffset) return false;
      previousOffset = word.to;
    }
  }
  return previousOffset > 0;
}

export function narrationMediaPath(version: string, index: number) {
  return `/_blog-narration/${version}/${index}.wav`;
}
