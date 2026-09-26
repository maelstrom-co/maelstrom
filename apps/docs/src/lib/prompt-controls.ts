export interface PromptControlOptions {
  body: string;
  filename: string;
  clipboard?: Pick<Clipboard, 'writeText'>;
  document?: Document;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

export async function copyPromptBody(
  body: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined = navigator.clipboard,
): Promise<void> {
  if (!clipboard?.writeText) throw new Error('Clipboard is unavailable');
  await clipboard.writeText(body);
}

export function downloadPromptBody(
  body: string,
  filename: string,
  options: Pick<
    PromptControlOptions,
    'document' | 'createObjectURL' | 'revokeObjectURL'
  > = {},
): void {
  const doc = options.document ?? document;
  const createURL = options.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeURL = options.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const url = createURL(
    new Blob([body], { type: 'text/markdown;charset=utf-8' }),
  );
  const link = doc.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  doc.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    revokeURL(url);
  }
}

export function initPromptControls(
  root: ParentNode,
  options: PromptControlOptions,
): void {
  const rootElement = root as HTMLElement;
  if (rootElement.dataset?.promptControlsInitialized) return;
  if (rootElement.dataset)
    rootElement.dataset.promptControlsInitialized = 'true';
  const status = root.querySelector<HTMLElement>('[data-prompt-status]');
  const copy = root.querySelector<HTMLButtonElement>('[data-copy-prompt]');
  const download = root.querySelector<HTMLButtonElement>(
    '[data-download-prompt]',
  );
  copy?.addEventListener('click', async () => {
    if (status) status.textContent = 'Copying prompt…';
    try {
      await copyPromptBody(options.body, options.clipboard);
      if (status) status.textContent = 'Prompt copied.';
    } catch {
      if (status)
        status.textContent =
          'Could not copy prompt. Check clipboard permissions and try again.';
    }
  });
  download?.addEventListener('click', () => {
    try {
      downloadPromptBody(options.body, options.filename, options);
      if (status) status.textContent = `Download started: ${options.filename}`;
    } catch {
      if (status) status.textContent = 'Could not download prompt. Try again.';
    }
  });
}
