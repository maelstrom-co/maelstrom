import { safeGetItem, safeSetItem } from './preferences';

class PageFeedback extends HTMLElement {
  #ac = new AbortController();

  connectedCallback() {
    this.#ac = new AbortController();
    const { signal } = this.#ac;
    const pageId = this.dataset.pageId;
    const stored = safeGetItem(`feedback:${pageId}`);

    if (stored) {
      const btn = this.querySelector(`[data-value="${stored}"]`);
      if (btn) btn.setAttribute('data-selected', 'true');
    }

    this.querySelectorAll('.feedback-btn').forEach((btn) => {
      btn.addEventListener(
        'click',
        () => {
          const value = (btn as HTMLElement).dataset.value;
          this.querySelectorAll('.feedback-btn').forEach((b) => {
            b.removeAttribute('data-selected');
          });
          btn.setAttribute('data-selected', 'true');
          safeSetItem(`feedback:${pageId}`, value || '');

          // Read at click time, not load time: PostHog is injected
          // asynchronously, so it may be absent when this element mounts.
          const { posthog } = window as typeof window & {
            posthog?: { capture?: (...args: unknown[]) => void };
          };
          if (typeof posthog?.capture === 'function') {
            posthog.capture('on_rate_docs', {
              page: pageId,
              rating: value,
              url: window.location.pathname,
            });
          }
        },
        { signal },
      );
    });
  }

  disconnectedCallback() {
    this.#ac.abort();
  }
}

customElements.define('page-feedback', PageFeedback);
