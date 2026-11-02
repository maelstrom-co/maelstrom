// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WeatherSkeleton } from './weather.skeleton';

afterEach(cleanup);

describe('WeatherSkeleton', () => {
  it('offers a one-row strip for short regions alongside the card', () => {
    const { container } = render(
      <WeatherSkeleton vesselId="weather-skeleton-test" />,
    );
    const root = container.querySelector('.weather-skeleton');
    expect(root).not.toBeNull();
    expect(root?.querySelector('.weather-skeleton__card')).not.toBeNull();
    const strip = root?.querySelector('.weather-skeleton__strip');
    expect(strip).not.toBeNull();
    expect(strip?.querySelector('.vessel-card')).toBeNull();
  });

  it('keeps its pulse off for reduced motion', () => {
    const { container } = render(
      <WeatherSkeleton vesselId="weather-skeleton-test" />,
    );
    for (const pulse of container.querySelectorAll('.animate-pulse'))
      expect(pulse.classList.contains('motion-reduce:animate-none')).toBe(true);
  });
});
