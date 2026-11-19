import { documentToMarkdown } from './page-markdown';

export { domToMarkdown } from './page-markdown';

const initializedButtons = new WeakSet<Element>();

/** Attach click handlers to all `.copy-for-ai-btn` elements on the page. */
export function initCopyForAi(): void {
  document.querySelectorAll('.copy-for-ai-btn').forEach((btn) => {
    if (initializedButtons.has(btn)) return;
    initializedButtons.add(btn);
    btn.addEventListener('click', async () => {
      try {
        const markdown = documentToMarkdown(document);
        if (markdown === null) return;
        await navigator.clipboard.writeText(markdown);
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
        setTimeout(() => {
          btn.innerHTML = original;
        }, 2000);
      } catch {
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Copy failed`;
        setTimeout(() => {
          btn.innerHTML = original;
        }, 2000);
      }
    });
  });
}
