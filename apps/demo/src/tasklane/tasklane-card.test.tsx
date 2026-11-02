// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TasklaneCard } from './tasklane-card';

afterEach(cleanup);

describe('TasklaneCard', () => {
  it('renders the title as a level 2 heading', () => {
    render(
      <TasklaneCard title="Triage inbox" meta="3 items">
        <p>body</p>
      </TasklaneCard>,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Triage inbox' }),
    ).toBeTruthy();
  });
});
