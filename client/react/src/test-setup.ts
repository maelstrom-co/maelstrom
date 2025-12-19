import '@testing-library/jest-dom/vitest';

// Mock ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe() {
    // Simulate a resize event with mock dimensions
    this.callback(
      [
        {
          contentRect: { width: 800, height: 600 } as DOMRectReadOnly,
          target: document.createElement('div'),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this
    );
  }

  unobserve() {}
  disconnect() {}
};
