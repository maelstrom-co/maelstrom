import { beforeEach, describe, expect, it } from 'bun:test';
import '../page-feedback';

describe('PageFeedback custom element', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  function buildFeedback(pageId = 'test-page') {
    const el = document.createElement('page-feedback');
    el.classList.add('page-feedback');
    el.setAttribute('data-page-id', pageId);
    el.innerHTML = `
      <button class="feedback-btn" data-value="good" type="button">Good</button>
      <button class="feedback-btn" data-value="bad" type="button">Bad</button>
    `;
    document.body.appendChild(el);
    return el;
  }

  it('restores saved feedback on connect', () => {
    localStorage.setItem('feedback:test-page', 'good');
    const el = buildFeedback();

    const goodBtn = el.querySelector('[data-value="good"]');
    expect(goodBtn!.getAttribute('data-selected')).toBe('true');
  });

  it('does not select any button when no feedback is saved', () => {
    const el = buildFeedback();

    const selected = el.querySelector('[data-selected="true"]');
    expect(selected).toBeNull();
  });

  it('selects button and saves to localStorage on click', () => {
    const el = buildFeedback();
    const goodBtn = el.querySelector('[data-value="good"]') as HTMLElement;

    goodBtn.click();

    expect(goodBtn.getAttribute('data-selected')).toBe('true');
    expect(localStorage.getItem('feedback:test-page')).toBe('good');
  });

  it('deselects previous button when clicking a different one', () => {
    const el = buildFeedback();
    const goodBtn = el.querySelector('[data-value="good"]') as HTMLElement;
    const badBtn = el.querySelector('[data-value="bad"]') as HTMLElement;

    goodBtn.click();
    badBtn.click();

    expect(goodBtn.getAttribute('data-selected')).toBeNull();
    expect(badBtn.getAttribute('data-selected')).toBe('true');
    expect(localStorage.getItem('feedback:test-page')).toBe('bad');
  });

  it('cleans up event listeners on disconnect', () => {
    const el = buildFeedback();
    expect(() => el.remove()).not.toThrow();
  });

  it('uses page ID from data attribute for localStorage key', () => {
    const el = buildFeedback('custom-page-id');
    const goodBtn = el.querySelector('[data-value="good"]') as HTMLElement;

    goodBtn.click();

    expect(localStorage.getItem('feedback:custom-page-id')).toBe('good');
  });
});
