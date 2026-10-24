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
  const body = element('div', undefined, 'evidence-guidance-body');
  disclosure.append(body);
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
      const scrollTop = disclosure.scrollTop;
      body.replaceChildren();
      body.append(
        element(
          'p',
          `${guidance.source} · ${scope}. Setup observations use retained evidence before view filters. Loss and hidden-event counts cover the whole source.`,
          'muted guidance-scope',
        ),
      );
      if (apps.length) {
        const group = element('section');
        group.dataset.guidance = 'apps';
        group.append(element('h3', 'App instances'));
        for (const app of apps)
          group.append(
            element(
              'p',
              `${app.label} · ${app.attachment}. ${app.connection}.`,
            ),
          );
        if (guidance.apps.length > apps.length)
          group.append(
            element(
              'p',
              `${guidance.apps.length - apps.length} more app instances. Use the App instance selector to inspect one.`,
            ),
          );
        body.append(group);
      }
      for (const item of guidance.items) {
        const section = element('section');
        section.dataset.guidance = item.id;
        section.append(element('h3', item.title), element('p', item.detail));
        if (item.nextStep) section.append(element('p', item.nextStep, 'muted'));
        body.append(section);
      }
      disclosure.scrollTop = scrollTop;
    },
  };
}
