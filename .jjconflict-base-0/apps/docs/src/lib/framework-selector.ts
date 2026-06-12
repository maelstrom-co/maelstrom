import { safeGetItem, safeSetItem } from './preferences';

export const FRAMEWORK_LABELS: Record<string, string> = {
  react: 'React',
  vanilla: 'Vanilla JS',
  solid: 'Solid',
};

export const LABEL_TO_FRAMEWORK: Record<string, string> = Object.fromEntries(
  Object.entries(FRAMEWORK_LABELS).map(([k, v]) => [v, k]),
);

/** Switch visible Starlight <Tabs syncKey="framework"> without stealing focus. */
export function syncStarlightTabs(label: string) {
  document
    .querySelectorAll('starlight-tabs[data-sync-key="framework"]')
    .forEach((tabGroup) => {
      const tabs = [
        ...tabGroup.querySelectorAll<HTMLElement>('[role="tab"]'),
      ];
      const panels = [
        ...tabGroup.querySelectorAll<HTMLElement>(':scope > [role="tabpanel"]'),
      ];
      const idx = tabs.findIndex((t) => t.textContent?.trim() === label);
      if (idx < 0) return;
      tabs.forEach((tab, i) => {
        tab.setAttribute('aria-selected', i === idx ? 'true' : 'false');
        tab.setAttribute('tabindex', i === idx ? '0' : '-1');
      });
      panels.forEach((panel, i) => {
        panel.hidden = i !== idx;
      });
    });
}

class FrameworkSelector extends HTMLElement {
  #ac = new AbortController();

  connectedCallback() {
    this.#ac = new AbortController();
    const { signal } = this.#ac;
    const trigger = this.querySelector('.framework-trigger') as HTMLButtonElement;
    const menu = this.querySelector('.framework-menu') as HTMLUListElement;
    const options = [
      ...menu.querySelectorAll<HTMLLIElement>('li:not(.coming-soon)'),
    ];

    options.forEach((item) => item.setAttribute('tabindex', '-1'));

    const saved = safeGetItem('maelstrom-framework') || 'react';
    this.#selectFramework(saved);
    const savedLabel = FRAMEWORK_LABELS[saved];
    if (savedLabel) {
      safeSetItem('starlight-synced-tabs__framework', savedLabel);
    }

    const open = () => trigger.setAttribute('aria-expanded', 'true');
    const close = () => trigger.setAttribute('aria-expanded', 'false');
    const isOpen = () => trigger.getAttribute('aria-expanded') === 'true';

    const pick = (fw: string) => {
      this.#selectFramework(fw);
      close();
      trigger.focus();
      safeSetItem('maelstrom-framework', fw);
      const label = FRAMEWORK_LABELS[fw];
      if (label) {
        safeSetItem('starlight-synced-tabs__framework', label);
        syncStarlightTabs(label);
      }
    };

    trigger.addEventListener('click', () => (isOpen() ? close() : open()), { signal });

    options.forEach((item) => {
      item.addEventListener('click', () => pick(item.dataset.framework || 'react'), { signal });
    });

    this.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        trigger.focus();
        return;
      }

      if (!isOpen()) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          open();
          options[0]?.focus();
        }
        return;
      }

      const focusedIdx = options.indexOf(document.activeElement as HTMLLIElement);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = focusedIdx < options.length - 1 ? focusedIdx + 1 : 0;
        options[next]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = focusedIdx > 0 ? focusedIdx - 1 : options.length - 1;
        options[prev]?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (focusedIdx >= 0) pick(options[focusedIdx].dataset.framework || 'react');
      } else if (e.key === 'Home') {
        e.preventDefault();
        options[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        options[options.length - 1]?.focus();
      }
    }, { signal });

    document.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest?.(
        'starlight-tabs[data-sync-key="framework"] [role="tab"]',
      );
      if (!tab) return;
      const label = tab.textContent?.trim() || '';
      const fw = LABEL_TO_FRAMEWORK[label];
      if (fw) {
        this.#selectFramework(fw);
        safeSetItem('maelstrom-framework', fw);
      }
    }, { signal });

    document.addEventListener('click', (e) => {
      if (!this.contains(e.target as Node)) close();
    }, { signal });
  }

  disconnectedCallback() {
    this.#ac.abort();
  }

  #selectFramework(fw: string) {
    const label = this.querySelector('.framework-label');
    const triggerIcon = this.querySelector('.framework-icon');
    const items = this.querySelectorAll('.framework-menu li');

    items.forEach((item) => {
      const isCurrent = (item as HTMLElement).dataset.framework === fw;
      item.setAttribute('aria-selected', String(isCurrent));
      if (isCurrent && label) {
        const optLabel = item.querySelector('.fw-option-label');
        label.textContent = optLabel?.textContent || fw;
        const itemIcon = item.querySelector('.fw-option-icon');
        if (itemIcon && triggerIcon) {
          triggerIcon.innerHTML = itemIcon.innerHTML;
        }
      }
    });
  }
}

customElements.define('framework-selector', FrameworkSelector);
