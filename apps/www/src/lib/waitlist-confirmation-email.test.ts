import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildWaitlistConfirmationEmail } from './waitlist-confirmation-email';

const token = `v1.${'a'.repeat(43)}`;
const confirmationUrl = `https://maelstrom-ai.co/waitlist/confirm/#token=${token}`;

function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5]
      .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

describe('waitlist confirmation email', () => {
  test('keeps HTML and plaintext on the same single-use confirmation URL', () => {
    const message = buildWaitlistConfirmationEmail(token);

    expect(message.html).toContain(`href="${confirmationUrl}"`);
    expect(message.text).toContain(confirmationUrl);
    expect(message.html.split(`href="${confirmationUrl}"`)).toHaveLength(3);
    expect(message.html).not.toContain(`?token=${token}`);
    expect(message.text).not.toContain(`?token=${token}`);
  });

  test('preserves expiry and unsolicited-request safety copy in both formats', () => {
    const message = buildWaitlistConfirmationEmail(token);

    for (const content of [message.html, message.text]) {
      expect(content).toContain('expires in 24 hours');
      expect(content).toContain('did not request this');
      expect(content).toContain('safely ignore this email');
    }
  });

  test('uses portable semantic email markup without remote tracking images', () => {
    const message = buildWaitlistConfirmationEmail(token);

    expect(message.html).toStartWith('<!doctype html>');
    expect(message.html).toContain('<html lang="en">');
    expect(message.html).toContain('role="article"');
    expect(message.html).toContain('role="presentation"');
    expect(message.html).toContain('>Confirm my email</a>');
    expect(message.html).toContain('#0091ff');
    expect(message.html).not.toContain('<img');
    expect(message.text).not.toContain('<');
  });

  test('keeps the CTA readable and padded in Outlook', () => {
    const message = buildWaitlistConfirmationEmail(token);
    const colors = message.html.match(
      /bgcolor="(#[0-9a-f]{6})"[^>]*>[\s\S]*?<a[^>]*style="[^"]*color:(#[0-9a-f]{6})/i,
    );

    expect(colors).not.toBeNull();
    expect(
      contrastRatio(colors?.[1] ?? '', colors?.[2] ?? ''),
    ).toBeGreaterThanOrEqual(4.5);
    expect(message.html).toContain('<!--[if mso]>');
    expect(message.html).toContain('mso-padding-alt:14px 24px');
  });

  test('keeps analytics disabled while the confirmation page handles the token', () => {
    const page = readFileSync(
      resolve(import.meta.dir, '../pages/waitlist/confirm.astro'),
      'utf8',
    );
    const layout = readFileSync(
      resolve(import.meta.dir, '../layouts/Layout.astro'),
      'utf8',
    );

    expect(page).toContain('analytics={false}');
    expect(layout).toContain('{analytics && <PostHog />}');
  });
});
