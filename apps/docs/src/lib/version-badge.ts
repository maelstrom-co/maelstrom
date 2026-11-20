import { navigate } from 'astro:transitions/client';

class VersionBadge extends HTMLElement {
  #ac = new AbortController();

  connectedCallback() {
    this.#ac = new AbortController();
    const { signal } = this.#ac;
    const trigger = this.querySelector<HTMLButtonElement>(
      '[data-docs-version-badge]',
    );
    const items = [
      ...this.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'),
    ];
    if (!trigger || items.length === 0) return;

    const isOpen = () => trigger.getAttribute('aria-expanded') === 'true';
    const close = (restoreFocus: boolean) => {
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    };
    const open = (focusIndex: number) => {
      trigger.setAttribute('aria-expanded', 'true');
      items.at(focusIndex)?.focus();
    };
    const currentIndex = () =>
      Math.max(
        0,
        items.findIndex((item) => item.getAttribute('aria-current') === 'page'),
      );
    const select = (item: HTMLAnchorElement) => {
      close(true);
      void navigate(item.href);
    };

    trigger.addEventListener(
      'click',
      () => (isOpen() ? close(false) : open(currentIndex())),
      { signal },
    );

    for (const item of items) {
      item.addEventListener(
        'click',
        (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          select(item);
        },
        { signal },
      );
    }

    this.addEventListener(
      'keydown',
      (event) => {
        const focused = items.indexOf(
          document.activeElement as HTMLAnchorElement,
        );

        if (event.key === 'Escape' && isOpen()) {
          event.preventDefault();
          close(true);
          return;
        }

        if (!isOpen()) {
          if (event.target !== trigger) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open(event.key === 'ArrowDown' ? currentIndex() : -1);
          }
          return;
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          items[(focused + 1) % items.length]?.focus();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          items.at(focused <= 0 ? -1 : focused - 1)?.focus();
        } else if (event.key === 'Home') {
          event.preventDefault();
          items[0]?.focus();
        } else if (event.key === 'End') {
          event.preventDefault();
          items.at(-1)?.focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
          const item = items[focused];
          if (!item) return;
          event.preventDefault();
          select(item);
        } else if (event.key === 'Tab') {
          close(false);
        }
      },
      { signal },
    );

    document.addEventListener(
      'click',
      (event) => {
        if (isOpen() && !this.contains(event.target as Node)) close(false);
      },
      { signal },
    );
  }

  disconnectedCallback() {
    this.#ac.abort();
  }
}

if (!customElements.get('version-badge')) {
  customElements.define('version-badge', VersionBadge);
}
