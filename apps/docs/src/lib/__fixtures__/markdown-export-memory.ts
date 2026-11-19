import { setImmediate } from 'node:timers/promises';

import { htmlToMarkdown } from '../llm-docs-integration';

async function verifyRetention(): Promise<void> {
  const collect: unknown = Reflect.get(globalThis, 'gc');
  if (typeof collect !== 'function') throw new Error('Run with --expose-gc.');
  const html =
    '<h1>Guide</h1><div class="sl-markdown-content">' +
    '<p>Keep <a href="/guide/">the guide</a> and <code>greetingVessel</code>.</p>'.repeat(
      600,
    ) +
    '</div>';
  const url = new URL('https://docs.example/guide/');
  for (let warmup = 0; warmup < 3; warmup++) {
    htmlToMarkdown(html, url);
    await setImmediate();
  }
  collect();
  const before = process.memoryUsage().heapUsed;
  for (let page = 0; page < 60; page++) {
    const markdown = htmlToMarkdown(html, url);
    if (!markdown?.includes('[the guide](https://docs.example/guide/)'))
      throw new Error('Missing page content.');
    await setImmediate();
    if (page % 10 === 9) collect();
  }
  collect();
  const growth = process.memoryUsage().heapUsed - before;
  if (growth > 64 * 1024 * 1024)
    throw new Error(
      `Exports retain ${Math.round(growth / 1024 / 1024)} MiB after collection.`,
    );
  console.log('Repeated page exports release parser state.');
}

verifyRetention().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
