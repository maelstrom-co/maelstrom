import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';

describe('component test infra', () => {
  it('renders a React element into jsdom', () => {
    render(<button type="button">hello</button>);
    expect(screen.getByRole('button', { name: 'hello' })).not.toBeNull();
  });

  it('exposes a matchMedia stub', () => {
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(
      false,
    );
  });
});
