import { describe, it, expect, beforeEach } from 'bun:test';
import { resolveActiveIndex, buildSerpentinePath, initTocPath, cleanupTocPath } from '../toc-path';

describe('resolveActiveIndex', () => {
  it('returns 0 for empty headings array', () => {
    expect(resolveActiveIndex([], 0, 2000, 800)).toBe(0);
  });

  it('returns 0 when no heading has scrolled past the offset', () => {
    expect(resolveActiveIndex([200, 400, 600], 0, 2000, 800)).toBe(0);
  });

  it('returns the last heading that scrolled past the offset', () => {
    expect(resolveActiveIndex([50, 80, 150, 300], 0, 2000, 800)).toBe(1);
  });

  it('returns last index when all headings are past offset', () => {
    expect(resolveActiveIndex([10, 20, 30], 0, 2000, 800)).toBe(2);
  });

  it('uses base offset when far from page bottom', () => {
    expect(resolveActiveIndex([99, 101], 0, 5000, 800)).toBe(0);
  });

  it('expands offset near bottom of page', () => {
    expect(resolveActiveIndex([350, 450], 4200, 5000, 800)).toBe(0);
  });

  it('at exact bottom, offset equals half viewport height', () => {
    const vh = 800;
    const scrollHeight = 2000;
    const scrollY = scrollHeight - vh;
    expect(resolveActiveIndex([399, 401], scrollY, scrollHeight, vh)).toBe(0);
  });

  it('handles single heading', () => {
    expect(resolveActiveIndex([50], 0, 2000, 800)).toBe(0);
    expect(resolveActiveIndex([200], 0, 2000, 800)).toBe(0);
  });
});

describe('buildSerpentinePath', () => {
  it('returns empty string for empty points', () => {
    expect(buildSerpentinePath([])).toBe('');
  });

  it('returns a move-to for a single point', () => {
    expect(buildSerpentinePath([{ x: 10, y: 20 }])).toBe('M 10,20');
  });

  it('builds a cubic bezier for two points', () => {
    const result = buildSerpentinePath([
      { x: 10, y: 20 },
      { x: 30, y: 60 },
    ]);
    expect(result).toBe('M 10,20 C 10,40 30,40 30,60');
  });

  it('builds multiple bezier segments', () => {
    const result = buildSerpentinePath([
      { x: 2, y: 10 },
      { x: 8, y: 30 },
      { x: 4, y: 50 },
    ]);
    expect(result).toBe('M 2,10 C 2,20 8,20 8,30 C 8,40 4,40 4,50');
  });

  it('handles points with same x (vertical line)', () => {
    const result = buildSerpentinePath([
      { x: 5, y: 0 },
      { x: 5, y: 100 },
    ]);
    expect(result).toBe('M 5,0 C 5,50 5,50 5,100');
  });
});

describe('initTocPath', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    cleanupTocPath();
  });

  function buildToc(linkCount: number) {
    const tocEl = document.createElement('starlight-toc');
    const nav = document.createElement('nav');
    const ul = document.createElement('ul');
    for (let i = 0; i < linkCount; i++) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#heading-${i}`;
      a.textContent = `Heading ${i}`;
      li.appendChild(a);
      ul.appendChild(li);

      const heading = document.createElement('h2');
      heading.id = `heading-${i}`;
      document.body.appendChild(heading);
    }
    nav.appendChild(ul);
    tocEl.appendChild(nav);
    document.body.appendChild(tocEl);
    return ul;
  }

  it('does nothing when no starlight-toc element exists', () => {
    initTocPath();
    expect(document.querySelector('.toc-items-wrapper')).toBeNull();
  });

  it('does nothing when ToC has fewer than 2 links', () => {
    buildToc(1);
    initTocPath();
    expect(document.querySelector('.toc-items-wrapper')).toBeNull();
  });

  it('wraps the ToC list in a .toc-items-wrapper', () => {
    buildToc(3);
    initTocPath();
    const wrapper = document.querySelector('.toc-items-wrapper');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('ul')).not.toBeNull();
  });

  it('creates an SVG with bg and active paths', () => {
    buildToc(3);
    initTocPath();
    const svg = document.querySelector('.toc-path-svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(svg!.querySelector('.toc-path-bg')).not.toBeNull();
    expect(svg!.querySelector('.toc-path-active')).not.toBeNull();
  });

  it('is idempotent — does not double-wrap on second call', () => {
    buildToc(3);
    initTocPath();
    initTocPath();
    const wrappers = document.querySelectorAll('.toc-items-wrapper');
    expect(wrappers.length).toBe(1);
  });

  it('marks exactly one link as active', () => {
    buildToc(3);
    initTocPath();
    const activeLinks = document.querySelectorAll('starlight-toc a.toc-active');
    expect(activeLinks.length).toBe(1);
  });

  it('cleanupTocPath is safe to call when not initialized', () => {
    expect(() => cleanupTocPath()).not.toThrow();
  });
});
