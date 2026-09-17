// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AssistantResponse } from './assistant-response';

afterEach(cleanup);

describe('AssistantResponse', () => {
  it('turns a successful no-op request into visible feedback', () => {
    const { rerender } = render(
      <AssistantResponse
        isProcessing={false}
        message={undefined}
        voiceActive={false}
      />,
    );

    expect(screen.queryByRole('status')).toBeNull();

    rerender(
      <AssistantResponse
        isProcessing
        message={undefined}
        voiceActive={false}
      />,
    );
    expect(screen.getByText(/maelstrom is thinking/i)).toBeTruthy();

    rerender(
      <AssistantResponse
        isProcessing={false}
        message="I can arrange your calendar, tasks, journal, weather, and routes."
        voiceActive={false}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain(
      'I can arrange your calendar, tasks, journal, weather, and routes.',
    );
  });

  it('renders no assistant card after a text-free accepted plan settles', () => {
    render(
      <AssistantResponse
        isProcessing={false}
        message={undefined}
        voiceActive={false}
      />,
    );

    expect(screen.queryByLabelText('Maelstrom response')).toBeNull();
  });

  it('moves by keyboard and resets without making response text a drag target', () => {
    const { container } = render(
      <AssistantResponse
        isProcessing={false}
        message="Your workspace is ready."
        voiceActive={false}
      />,
    );
    const handle = screen.getByRole('button', {
      name: 'Move Maelstrom response',
    }) as HTMLButtonElement;
    const positioner = container.querySelector(
      '.assistant-response-positioner',
    ) as HTMLElement;
    positioner.getBoundingClientRect = () => new DOMRect(100, 100, 400, 80);
    handle.setPointerCapture = () => undefined;

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(positioner.style.transform).toBe('translate3d(12px, 0px, 0)');

    fireEvent.keyDown(handle, { key: 'Home' });
    expect(positioner.style.transform).toBe('translate3d(0px, 0px, 0)');

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 240,
      clientY: 170,
    });
    expect(positioner.style.transform).toBe('translate3d(40px, -30px, 0)');

    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 5000,
      clientY: 5000,
    });
    expect(positioner.style.transform).toBe(
      `translate3d(${window.innerWidth - 508}px, ${window.innerHeight - 188}px, 0)`,
    );
  });

  it('cancels an active drag when a viewport resize resets the card', () => {
    const { container } = render(
      <AssistantResponse
        isProcessing={false}
        message="Your workspace is ready."
        voiceActive={false}
      />,
    );
    const handle = screen.getByRole('button', {
      name: 'Move Maelstrom response',
    }) as HTMLButtonElement;
    const positioner = container.querySelector(
      '.assistant-response-positioner',
    ) as HTMLElement;
    positioner.getBoundingClientRect = () => new DOMRect(100, 100, 400, 80);
    handle.setPointerCapture = () => undefined;

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    fireEvent(window, new Event('resize'));
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 260,
      clientY: 240,
    });

    expect(positioner.style.transform).toBe('translate3d(0px, 0px, 0)');
    expect(
      (
        container.querySelector('.assistant-response') as HTMLElement
      ).hasAttribute('data-dragging'),
    ).toBe(false);
  });

  it('keeps response announcements text-only and exposes scrolling separately', () => {
    const { container } = render(
      <AssistantResponse
        isProcessing={false}
        message="A long response that may need scrolling."
        voiceActive={false}
      />,
    );
    const status = screen.getByRole('status');
    const handle = screen.getByRole('button', {
      name: 'Move Maelstrom response',
    });

    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(status.contains(handle)).toBe(false);
    expect(
      (container.querySelector('.assistant-response') as HTMLElement).tabIndex,
    ).toBe(0);
    expect(handle.getAttribute('aria-keyshortcuts')).toContain('ArrowLeft');
    expect(handle.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('re-clamps a bottom-aligned thinking card when the completed reply grows', () => {
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 500,
    });

    const { container, rerender } = render(
      <AssistantResponse
        isProcessing
        message={undefined}
        voiceActive={false}
      />,
    );
    const handle = screen.getByRole('button', {
      name: 'Move Maelstrom response',
    }) as HTMLButtonElement;
    const positioner = container.querySelector(
      '.assistant-response-positioner',
    ) as HTMLElement;
    positioner.getBoundingClientRect = () => new DOMRect(100, 100, 400, 40);
    handle.setPointerCapture = () => undefined;

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 200,
      clientY: 1000,
    });
    expect(positioner.style.transform).toBe('translate3d(0px, 352px, 0)');

    positioner.getBoundingClientRect = () => new DOMRect(100, 452, 400, 120);
    rerender(
      <AssistantResponse
        isProcessing={false}
        message="This completed response is substantially taller than thinking."
        voiceActive={false}
      />,
    );

    expect(positioner.style.transform).toBe('translate3d(0px, 272px, 0)');
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 200,
      clientY: 1100,
    });
    expect(positioner.style.transform).toBe('translate3d(0px, 272px, 0)');
    expect(
      (
        container.querySelector('.assistant-response') as HTMLElement
      ).hasAttribute('data-dragging'),
    ).toBe(false);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalHeight,
    });
  });

  it('hides typed feedback while a voice session is active', () => {
    render(
      <AssistantResponse
        isProcessing={false}
        message="This should not compete with voice."
        voiceActive
      />,
    );

    expect(screen.queryByRole('status')).toBeNull();
  });
});
