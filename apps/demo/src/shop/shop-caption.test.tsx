// @vitest-environment happy-dom

import type {
  UseVoiceCaptionsOptions,
  UseVoiceCaptionsResult,
} from '@maelstrom-co/react-realtime';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const NO_CAPTIONS: UseVoiceCaptionsResult = {
  user: undefined,
  assistant: undefined,
};

let captionsResult: UseVoiceCaptionsResult = NO_CAPTIONS;
const captionOptions: UseVoiceCaptionsOptions[] = [];

vi.doMock('./maelstrom', () => ({
  shopM: {
    useVoiceCaptions: (options: UseVoiceCaptionsOptions) => {
      captionOptions.push(options);
      return captionsResult;
    },
  },
}));

const { ShopCaption } = await import('./shop-caption');

function renderCaption(next: Partial<UseVoiceCaptionsResult>) {
  captionsResult = { ...NO_CAPTIONS, ...next };
  return render(<ShopCaption />);
}

afterEach(() => {
  cleanup();
  captionOptions.length = 0;
});

const line = (container: HTMLElement) =>
  container.querySelector('.shop-caption-line');

describe('ShopCaption', () => {
  it('keeps the band mounted with no caption', () => {
    const { getByTestId, container } = renderCaption({});
    expect(getByTestId('shop-caption')).toBeTruthy();
    expect(line(container)).toBeNull();
  });

  it('shows only the user line and never assistant captions', () => {
    const { container } = renderCaption({
      user: { text: 'Second question', faded: false },
      assistant: { text: 'Assistant words', faded: false },
    });
    const lines = container.querySelectorAll('.shop-caption-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toBe('Second question');
    expect(container.textContent).not.toContain('Assistant words');
  });

  it('renders nothing for assistant-only captions', () => {
    const { container } = renderCaption({
      assistant: { text: 'Assistant words', faded: false },
    });
    expect(line(container)).toBeNull();
  });

  it('renders nothing for blank text', () => {
    const { container } = renderCaption({
      user: { text: '   ', faded: false },
    });
    expect(line(container)).toBeNull();
  });

  it('fades captions after 3s', () => {
    renderCaption({});
    expect(captionOptions.at(-1)).toEqual({ fadeDelayMs: 3000 });
  });

  it('marks a faded caption without unmounting the band', () => {
    const { container, getByTestId } = renderCaption({
      user: { text: 'Show the catalog', faded: true },
    });
    expect(line(container)?.getAttribute('data-faded')).toBe('true');
    expect(getByTestId('shop-caption')).toBeTruthy();
  });
});
