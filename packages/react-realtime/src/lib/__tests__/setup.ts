import { afterEach, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

let happyWindow: Window;

beforeEach(() => {
  setupHappyDom();
});

afterEach(() => {
  teardownHappyDom();
});

function setupHappyDom() {
  happyWindow = new Window();
  // @ts-expect-error - happy-dom types don't perfectly match DOM types
  globalThis.document = happyWindow.document;
  // @ts-expect-error - happy-dom types don't perfectly match DOM types
  globalThis.window = happyWindow;
}

function teardownHappyDom() {
  happyWindow.close();
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
}
