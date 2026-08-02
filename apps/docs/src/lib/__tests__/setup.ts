import { afterEach, beforeEach } from 'bun:test';
import { JSDOM } from 'jsdom';

// Create a single persistent jsdom instance whose globals are available at
// module-import time (i.e. before any beforeEach runs). This is required so
// that custom-element classes (which extend HTMLElement) can be defined when
// the module is first evaluated.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});

// Expose jsdom globals to the Bun runtime so imported modules see them.
(globalThis as Record<string, unknown>).document = dom.window.document;
(globalThis as Record<string, unknown>).window = dom.window;
(globalThis as Record<string, unknown>).navigator = dom.window.navigator;
(globalThis as Record<string, unknown>).localStorage = dom.window.localStorage;
(globalThis as Record<string, unknown>).Storage = dom.window.Storage;
(globalThis as Record<string, unknown>).KeyboardEvent =
  dom.window.KeyboardEvent;
(globalThis as Record<string, unknown>).Event = dom.window.Event;
(globalThis as Record<string, unknown>).customElements =
  dom.window.customElements;
(globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
(globalThis as Record<string, unknown>).AbortController =
  dom.window.AbortController;
(globalThis as Record<string, unknown>).AbortSignal = dom.window.AbortSignal;

// ResizeObserver is not implemented in jsdom — provide a no-op stub.
(globalThis as Record<string, unknown>).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  // Reset DOM content between tests without replacing the jsdom instance
  // (replacing it would invalidate the customElements registry).
  dom.window.document.body.innerHTML = '';
  dom.window.localStorage.clear();

  // Keep globalThis in sync (assignments above persist, but reassign for safety).
  (globalThis as Record<string, unknown>).document = dom.window.document;
  (globalThis as Record<string, unknown>).localStorage =
    dom.window.localStorage;
});

afterEach(() => {
  dom.window.document.body.innerHTML = '';
  dom.window.localStorage.clear();
});
