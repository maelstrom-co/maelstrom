import {
  WAITLIST_ORIGIN,
  WAITLIST_SENDER_ADDRESS,
} from '@maelstrom-co/platform-infra/waitlist-contract';

export function buildWaitlistConfirmationEmail(token: string) {
  const confirmationUrl = new URL('/waitlist/confirm/', WAITLIST_ORIGIN);
  confirmationUrl.hash = new URLSearchParams({ token }).toString();
  const url = confirmationUrl.href;

  return {
    from: {
      email: WAITLIST_SENDER_ADDRESS,
      name: 'Maelstrom',
    },
    subject: 'Confirm your email for Maelstrom',
    text: [
      'MAELSTROM PRIVATE BETA',
      '',
      'Confirm your email',
      '',
      'Thanks for joining the Maelstrom private beta waitlist.',
      'Confirm that you requested a place by opening this link:',
      '',
      url,
      '',
      'This link expires in 24 hours.',
      'If you did not request this, you can safely ignore this email.',
      '',
      'Maelstrom - AI-orchestrated UI',
      'https://maelstrom-ai.co',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>Confirm your email for Maelstrom</title>
  </head>
  <body style="margin:0;padding:0;background-color:#04060b;color:#e7ecf3;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Confirm your place on the Maelstrom private beta waitlist. This link expires in 24 hours.</div>
    <div role="article" aria-roledescription="email" aria-label="Confirm your Maelstrom private beta signup">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#04060b;">
        <tr>
          <td align="center" style="padding:40px 16px;">
            <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
              <tr>
                <td style="padding:0 0 20px;text-align:left;">
                  <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background-color:#0091ff;vertical-align:2px;margin-right:8px;"></span>
                  <span style="color:#e7ecf3;font-size:18px;font-weight:700;letter-spacing:-0.3px;">maelstrom</span>
                </td>
              </tr>
              <tr>
                <td style="padding:40px;border:1px solid #252b37;border-radius:20px;background-color:#0b0e16;text-align:left;">
                  <p style="margin:0 0 16px;color:#00c2ff;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Private beta</p>
                  <h1 style="margin:0 0 20px;color:#e7ecf3;font-size:36px;line-height:1.1;letter-spacing:-1.2px;">Confirm your email</h1>
                  <p style="margin:0 0 28px;color:#9aa3b2;font-size:16px;line-height:1.7;">Thanks for joining the Maelstrom private beta waitlist. Confirm that you requested a place to complete your signup.</p>
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;">
                    <tr>
                      <td align="center" bgcolor="#0066ff" style="border-radius:999px;background-color:#0066ff;mso-padding-alt:14px 24px;">
                        <a href="${url}" target="_blank" style="display:inline-block;padding:14px 24px;color:#ffffff;font-size:15px;font-weight:700;line-height:1;text-decoration:none;">Confirm my email</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:0 0 8px;color:#737d8c;font-size:13px;line-height:1.6;">If the button does not work, open this link:</p>
                  <p style="margin:0 0 28px;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${url}" style="color:#00c2ff;text-decoration:underline;">${url}</a></p>
                  <div style="height:1px;background-color:#252b37;margin:0 0 24px;"></div>
                  <p style="margin:0;color:#737d8c;font-size:13px;line-height:1.6;">This link expires in 24 hours. If you did not request this, you can safely ignore this email.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 8px 0;color:#737d8c;font-size:12px;line-height:1.6;text-align:center;">
                  Maelstrom &middot; AI-orchestrated UI<br>
                  <a href="https://maelstrom-ai.co" style="color:#9aa3b2;text-decoration:none;">maelstrom-ai.co</a>
                </td>
              </tr>
            </table>
            <!--[if mso]></td></tr></table><![endif]-->
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`,
  };
}
