// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoHeader } from './demo-header';

const { capture, init } = vi.hoisted(() => ({
  capture: vi.fn(),
  init: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  PostHog: class {
    init(...args: unknown[]) {
      init(...args);
      return { capture };
    }
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('beta invitation', () => {
  it('opens Discord even on previews without sending test activity to production', () => {
    const { getByRole } = render(<DemoHeader>{null}</DemoHeader>);
    const link = getByRole('link', { name: 'Join beta on Discord' });
    expect(link.getAttribute('href')).toBe('https://discord.gg/XAjJqrF2u3');
    expect(link.getAttribute('target')).toBe('_blank');
    fireEvent.click(link);
    expect(init).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('counts invitation clicks separately from other header links', async () => {
    vi.spyOn(window.location, 'hostname', 'get').mockReturnValue(
      'demo.maelstrom-ai.co',
    );
    const { getByRole } = render(<DemoHeader>{null}</DemoHeader>);
    expect(init).not.toHaveBeenCalled();
    fireEvent.click(getByRole('link', { name: 'Docs' }));
    expect(init).not.toHaveBeenCalled();
    const link = getByRole('link', { name: 'Join beta on Discord' });
    fireEvent.click(link);
    fireEvent.click(link);
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_performance: false,
        capture_exceptions: false,
        disable_session_recording: true,
        person_profiles: 'never',
      }),
    );
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledWith(
      'beta_discord_invite_clicked',
      { source: 'demo_header' },
      { transport: 'sendBeacon', send_instantly: true },
    );
  });
});
