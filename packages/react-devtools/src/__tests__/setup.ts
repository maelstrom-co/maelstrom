import { afterEach, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
let window: Window;
beforeEach(() => {
  window = new Window();
  // @ts-expect-error Happy DOM supplies the test DOM with a narrower platform surface.
  globalThis.window = window;
  // @ts-expect-error Happy DOM supplies the test DOM with a narrower platform surface.
  globalThis.document = window.document;
});
afterEach(() => {
  window.close();
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});
