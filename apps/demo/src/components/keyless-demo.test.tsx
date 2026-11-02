// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITY_NOTE } from './capability-note';
import { KeylessDemo } from './keyless-demo';

vi.mock('posthog-js', () => ({ PostHog: class {} }));

afterEach(() => cleanup());

function renderKeylessDemo() {
  return render(
    <KeylessDemo
      intent=""
      onIntentChange={vi.fn()}
      onRequireKey={vi.fn()}
      onBlockedSubmit={vi.fn()}
    />,
  );
}

describe('KeylessDemo', () => {
  it('presents Dayline as a sample app powered by Maelstrom', () => {
    renderKeylessDemo();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Dayline' }),
    ).toBeTruthy();
    expect(screen.getByText('Powered by Maelstrom')).toBeTruthy();
    expect(screen.getByText('Sample app')).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'Plan your day by saying what you need.',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('region', { name: 'Example Dayline workspace' }),
    ).toBeTruthy();
  });

  it('explains the host-app relationship before the key step', () => {
    renderKeylessDemo();

    const intro = screen.getByText('Sample app').parentElement;
    const paragraphs = [...(intro?.querySelectorAll('p') ?? [])].map(
      (p) => p.textContent,
    );
    expect(paragraphs).toEqual([
      'Sample app',
      "Dayline is a sample day planner with Maelstrom built in. Say what you need and Maelstrom uses Dayline's own Vessels (views) and Actions to do it.",
      CAPABILITY_NOTE,
      'Add an OpenAI API key to try it. The key stays in this tab and is never saved.',
    ]);
    const keyButton = screen.getByRole('button', {
      name: 'Start interactive demo',
    });
    expect(intro?.lastElementChild).toBe(keyButton);
  });

  it('asks what the visitor would like to do', () => {
    renderKeylessDemo();

    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe(
      'What would you like to do?',
    );
  });
});
