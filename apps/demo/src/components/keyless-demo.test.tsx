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

  it('explains the host-app relationship and current capabilities before the key step', () => {
    renderKeylessDemo();

    const intro = screen.getByText('Sample app').parentElement;
    const paragraphs = [...(intro?.querySelectorAll('p') ?? [])].map(
      (p) => p.textContent,
    );
    expect(paragraphs).toEqual([
      'Sample app',
      "Dayline is a sample day planner with Maelstrom built in. You work with its calendar, tasks and journal by typing or speaking, and Maelstrom picks the right views and runs Dayline's own Actions for you.",
      'Dayline, the host app, supplies the Vessels (its views) and the Actions they offer. Maelstrom does not connect other apps. A developer embeds it in their own app.',
      CAPABILITY_NOTE,
      "Add an OpenAI API key to try it. Start with GPT-Live for voice, or choose another provider above. The key stays in this tab's memory and is never persisted.",
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
