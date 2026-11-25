import {
  NarrationAttemptUnavailable,
  parseNarrationHtml,
  publishNarrationArticle,
  type NarrationPublication,
} from './blog-narration-publication';
import {
  articlePath,
  maxArticleCharacters,
  maxResponseBytes,
  maxTotalBytes,
  maxTotalCharacters,
  readNarrationText,
} from './preview-narration-baseline';

const maxArticles = 40;
const maxSynthesisCharacters = 20_000;

interface PreviewPublication {
  readTarget: () => Promise<string | undefined>;
  report?: (message: string) => void;
  readPriorityPaths?: () => Promise<readonly string[]>;
  maySynthesize?: (path: string, text: string) => boolean;
  requireSynthesisCurrent?: () => Promise<void>;
  deliveryBase: URL;
  deliver: (
    key: string,
    asset: string | Uint8Array,
    type: string,
  ) => Promise<void>;
  publication: NarrationPublication;
  requestPage?: (url: URL, init: RequestInit) => Promise<Response>;
}

export async function publishPreviewNarration(options: PreviewPublication) {
  const target = await options.readTarget();
  if (!target) return { status: 'stale' } as const;

  const requireCurrent = async () => {
    if ((await options.readTarget()) !== target) {
      throw new Error('Preview narration revision is no longer current');
    }
  };

  const responseTooLarge = new Error(
    'Preview narration HTML response byte limit exceeded',
  );
  const downloadExhausted = new Error(
    'Preview narration HTML download byte limit exceeded',
  );
  let bytes = 0;
  const getPage = async (path: string) => {
    if (bytes >= maxTotalBytes) throw downloadExhausted;
    const response = await (options.requestPage ?? fetch)(
      new URL(path, target),
      {
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
        headers: { accept: 'text/html', 'cache-control': 'no-cache' },
      },
    );
    if (
      !response.ok ||
      response.redirected ||
      !response.body ||
      response.headers
        .get('content-type')
        ?.split(';')[0]
        .trim()
        .toLowerCase() !== 'text/html'
    ) {
      await response.body?.cancel();
      throw new Error(
        `Unexpected preview HTML response for ${path} (HTTP ${response.status})`,
      );
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let html = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return parseNarrationHtml(html + decoder.decode());
        size += value.byteLength;
        bytes += value.byteLength;
        if (bytes > maxTotalBytes) throw downloadExhausted;
        if (size > maxResponseBytes) throw responseTooLarge;
        html += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel();
    }
  };

  const archive = await getPage('/blog/');
  const archiveMain = archive.querySelector('main.blog-archive');
  const marker = archiveMain?.getAttribute('data-narration-preview-base');
  if (!marker) return { status: 'unsupported' } as const;
  if (marker !== options.deliveryBase.href) {
    throw new Error(
      'Deployed blog archive does not match the approved preview revision',
    );
  }
  const links =
    archiveMain?.querySelectorAll('.blog-list .blog-card h2 > a') ?? [];
  const paths = new Set<string>();
  for (const link of links) {
    const path = link.getAttribute('href');
    if (path && /^https?:\/\//u.test(path)) {
      const external = new URL(path);
      if (
        !external.username &&
        !external.password &&
        external.origin !== new URL(target).origin
      )
        continue;
    }
    if (!path || articlePath.exec(path)?.[0] !== path || paths.has(path)) {
      throw new Error('Invalid or duplicate preview blog article path');
    }
    paths.add(path);
  }

  const priority = new Set(await options.readPriorityPaths?.());
  const selected = [...paths]
    .sort((a, b) => Number(priority.has(b)) - Number(priority.has(a)))
    .slice(0, maxArticles);
  const skipped = {
    older: paths.size - selected.length,
    download: 0,
    transcript: 0,
    budget: 0,
    held: 0,
    cacheOnly: 0,
  };
  let characters = 0;
  const articles: { path: string; text: string; legacyText?: string }[] = [];
  for (const [index, path] of selected.entries()) {
    let document: Document;
    try {
      document = await getPage(path);
    } catch (error) {
      if (error === downloadExhausted) {
        skipped.download += selected.length - index;
        break;
      }
      if (error !== responseTooLarge) throw error;
      skipped.download++;
      continue;
    }
    const main = document.querySelector('main.blog-page');
    const players = main?.querySelectorAll('article > [data-narration-player]');
    const player = players?.[0];
    const manifestUrl = new URL(
      `${path.slice(1)}narration.json`,
      options.deliveryBase,
    ).href;
    if (
      players?.length !== 1 ||
      player?.getAttribute('data-narration-player') !== manifestUrl ||
      player.getAttribute('data-narration-assets') !== options.deliveryBase.href
    ) {
      throw new Error(
        `Deployed preview narration locator does not match ${path}`,
      );
    }
    const text = readNarrationText(document, false);
    if (!text)
      throw new Error(`Missing eligible preview narration text in ${path}`);
    if (
      text.length > maxArticleCharacters ||
      characters + text.length > maxTotalCharacters
    ) {
      skipped.transcript++;
      continue;
    }
    characters += text.length;
    articles.push({
      path,
      text,
      legacyText: readNarrationText(document, false, true),
    });
  }

  const prefix = options.deliveryBase.pathname.slice(1, -1);
  let remainingSynthesis = maxSynthesisCharacters;
  const exhaustedBudget = new Error(
    'Preview narration synthesis budget exhausted',
  );
  const cacheOnly = new Error(
    'Preview narration has no verified spoken-text change',
  );
  let published = 0;
  for (const { path, text, legacyText } of articles) {
    try {
      await publishNarrationArticle(
        text,
        {
          ...options.publication,
          legacyText,
          async beforeSend() {
            await requireCurrent();
            await options.requireSynthesisCurrent?.();
          },
          async beforeSynthesis(length) {
            if (options.maySynthesize?.(path, text) !== true) {
              throw cacheOnly;
            }
            if (length > remainingSynthesis) {
              throw exhaustedBudget;
            }
            await options.publication.beforeSynthesis?.(length);
            await requireCurrent();
            await options.requireSynthesisCurrent?.();
            remainingSynthesis -= length;
          },
        },
        {
          writeAudio: (path, media) =>
            options.deliver(`${prefix}${path}`, media, 'audio/wav'),
          async writeManifest(manifest) {
            await requireCurrent();
            await options.deliver(
              `${prefix}${path}narration.json`,
              manifest,
              'application/json',
            );
          },
        },
      );
      published++;
    } catch (error) {
      if (error === cacheOnly) skipped.cacheOnly++;
      else if (error === exhaustedBudget) skipped.budget++;
      else if (error instanceof NarrationAttemptUnavailable) {
        skipped.held++;
        options.report?.(error.message);
      } else throw error;
    }
  }
  return { status: 'published', published, skipped } as const;
}
