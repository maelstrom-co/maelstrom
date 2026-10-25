import type { evidenceGuidance } from './evidence-guidance.js';
import { button, element } from './panel-elements.js';

export function createEvidenceGuidance(id: string) {
  const disclosure = element('section', undefined, 'evidence-guidance');
  disclosure.id = id;
  disclosure.hidden = true;
  disclosure.tabIndex = 0;
  disclosure.setAttribute('role', 'region');
  disclosure.setAttribute('aria-label', 'Evidence and setup details');
  const trigger = button(
    'Evidence & setup',
    () => {
      const open = trigger.getAttribute('aria-expanded') !== 'true';
      trigger.setAttribute('aria-expanded', String(open));
      disclosure.hidden = !open;
    },
    'guidance-trigger',
  );
  trigger.setAttribute('aria-label', 'Evidence & setup');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', id);
  const header = element('div', undefined, 'guidance-header');
  const scopeLabel = element('p', undefined, 'muted guidance-scope');
  const guides = element('details', undefined, 'guidance-guides');
  const links = element('nav', undefined, 'guidance-links');
  links.setAttribute('aria-label', 'DevTools setup guides');
  guides.append(element('summary', 'Setup guides'), links);
  for (const [label, anchor] of [
    ['App integration', 'install-and-open-the-tools'],
    ['Engine diagnostics', 'enable-optional-engine-evidence'],
    ['Voice diagnostics', 'find-voice-and-connection-events'],
    ['Recordings', 'record-and-reopen-a-problem'],
    ['Retention', 'configure-retention-and-presentation'],
  ]) {
    const link = element('a', label);
    link.href = `https://docs.maelstrom-ai.co/guides/devtools/#${anchor}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute(
      'aria-label',
      `${label} setup guide (opens in a new tab)`,
    );
    links.append(link);
  }
  const body = element('div', undefined, 'evidence-guidance-body');
  header.append(scopeLabel, guides);
  disclosure.append(header, body);
  const rows = new Map<
    string,
    {
      element: HTMLDetailsElement;
      summary: HTMLElement;
      content: HTMLDivElement;
    }
  >();
  let previous = '';
  return {
    element: disclosure,
    trigger,
    update(
      guidance: ReturnType<typeof evidenceGuidance>,
      appLabel: (id: string) => string,
    ) {
      const apps = guidance.apps.slice(0, 50).map((app) => ({
        ...app,
        label: appLabel(app.id),
      }));
      const scope =
        guidance.clientId === 'all'
          ? 'All app instances'
          : appLabel(guidance.clientId);
      const signature = JSON.stringify([
        guidance.source,
        scope,
        apps,
        guidance.apps.length,
        guidance.items,
      ]);
      if (signature === previous) return;
      previous = signature;
      scopeLabel.textContent = `${guidance.source} · Checks: ${scope}. Search and event filters ignored. Event counts: all apps.`;
      const items: Array<{
        id: string;
        title: string;
        paragraphs: Array<{ text: string; className?: string }>;
      }> = [];
      if (apps.length) {
        const paragraphs = apps.map((app) => ({
          text: `${app.label} · ${app.attachment}. ${app.connection}.`,
        }));
        if (guidance.apps.length > apps.length)
          paragraphs.push({
            text: `${guidance.apps.length - apps.length} more app instances. Use the App instance selector to inspect one.`,
          });
        items.push({
          id: 'apps',
          title: `App instances (${guidance.apps.length})`,
          paragraphs,
        });
      }
      for (const item of guidance.items)
        items.push({
          id: item.id,
          title: item.title,
          paragraphs: [
            { text: item.detail },
            ...(item.nextStep
              ? [{ text: item.nextStep, className: 'muted' }]
              : []),
          ],
        });
      const remaining = new Set(items.map((item) => item.id));
      for (const [key, row] of rows) {
        if (remaining.has(key)) continue;
        const root = disclosure.getRootNode() as ShadowRoot;
        if (row.element.contains(root.activeElement)) trigger.focus();
        row.element.remove();
        rows.delete(key);
      }
      for (const [index, item] of items.entries()) {
        let row = rows.get(item.id);
        if (!row) {
          const section = element('details', undefined, 'guidance-item');
          section.dataset.guidance = item.id;
          const summary = element('summary');
          const content = element('div', undefined, 'guidance-explanation');
          section.append(summary, content);
          row = { element: section, summary, content };
          rows.set(item.id, row);
        }
        row.summary.textContent = item.title;
        row.content.replaceChildren(
          ...item.paragraphs.map((paragraph) =>
            element('p', paragraph.text, paragraph.className),
          ),
        );
        if (body.children[index] !== row.element)
          body.insertBefore(row.element, body.children[index] ?? null);
      }
    },
  };
}
