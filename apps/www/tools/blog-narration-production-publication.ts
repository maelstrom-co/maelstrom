import {
  isNarrationHash,
  type NarrationManifest,
  narrationDigest,
  narrationManifestPath,
  validateManifest,
} from '../src/lib/blog-narration';
import { readBoundedNarrationBody } from './blog-narration-attempt';
import {
  narrationVoiceHash,
  NarrationAttemptUnavailable,
  parseNarrationHtml,
  publishNarrationArticle,
  type NarrationPublication,
} from './blog-narration-publication';
import { readNarrationText } from './preview-narration-baseline';

const productionOrigin = 'https://maelstrom-ai.co';
const pathPattern = /^\/blog\/(?!index\/|pages\/)[a-z0-9]+(?:-[a-z0-9]+)*\/$/u;
const releasePattern = /^[a-f0-9]{40}$/u;
const batchSize = 40;
const publicationInterval = 60 * 60 * 1000;
const synthesisBudget = 20_000;
const htmlLimit = 2 * 1024 * 1024;
const totalHtmlLimit = 30 * 1024 * 1024;

interface Recovery {
  publication: NarrationPublication;
  readDelivery: (path: string) => Promise<string | undefined>;
  deliver: (
    path: string,
    value: string | Uint8Array,
    type: string,
  ) => Promise<void>;
  requestPage?: (url: URL, init: RequestInit) => Promise<Response>;
  report?: (message: string) => void;
  prioritizeRecent?: boolean;
}

export async function recoverProductionNarration(options: Recovery) {
  const { publication } = options;
  const voiceHash = await narrationVoiceHash(publication);
  let downloaded = 0;
  const fetchPage = async (path: string) => {
    if (downloaded >= totalHtmlLimit)
      throw new NarrationAttemptUnavailable(
        'Production narration download budget exhausted',
      );
    const response = await (options.requestPage ?? fetch)(
      new URL(path, productionOrigin),
      {
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        headers: { accept: 'text/html', 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (
      !response.ok ||
      response.redirected ||
      response.headers.get('content-type')?.split(';')[0].trim() !== 'text/html'
    ) {
      await response.body?.cancel();
      throw new Error(
        `Published narration HTML unavailable at ${path} (HTTP ${response.status})`,
      );
    }
    const text = await readBoundedNarrationBody(
      response,
      Math.min(htmlLimit, totalHtmlLimit - downloaded),
      (length) => {
        downloaded += length;
      },
    );
    return parseNarrationHtml(text);
  };

  const archive = await fetchPage('/blog/');
  const archiveMain = archive.querySelector('main.blog-archive');
  const release = archiveMain?.getAttribute('data-narration-release');
  if (
    !archiveMain ||
    !release ||
    releasePattern.exec(release)?.[0] !== release ||
    archiveMain?.getAttribute('data-narration-voice') !== voiceHash
  ) {
    return {
      published: 0,
      skipped: 'Published website does not request this narration voice',
    };
  }

  const paths: string[] = [];
  for (const link of archiveMain.querySelectorAll(
    '.blog-list .blog-card h2 > a',
  )) {
    const path = link.getAttribute('href');
    if (!path || pathPattern.exec(path)?.[0] !== path || paths.includes(path)) {
      throw new Error('Invalid production narration archive link');
    }
    paths.push(path);
  }

  const checkArticle = async (path: string) => {
    const document = await fetchPage(path);
    const main = document.querySelector('main.blog-page');
    if (
      main?.getAttribute('data-narration-release') !== release ||
      main.getAttribute('data-narration-voice') !== voiceHash
    ) {
      throw new NarrationAttemptUnavailable(
        `Published narration release changed at ${path}`,
      );
    }
    const text = readNarrationText(document, false);
    if (!text) {
      throw new NarrationAttemptUnavailable(
        `Published narration text is unavailable at ${path}`,
      );
    }
    return { text, legacyText: readNarrationText(document, false, true) };
  };

  let remaining = synthesisBudget;
  let published = 0;
  const failures: string[] = [];
  const tick = Math.floor(
    (publication.now ?? Date.now)() / publicationInterval,
  );
  const offset = options.prioritizeRecent
    ? 0
    : tick % Math.max(1, paths.length);
  const selected = [...paths.slice(offset), ...paths.slice(0, offset)].slice(
    0,
    batchSize,
  );
  for (const path of selected) {
    try {
      const { text, legacyText } = await checkArticle(path);
      const textHash = await narrationDigest(text);
      if (!isNarrationHash(textHash))
        throw new Error('Invalid narration text hash');
      const publicPath = narrationManifestPath(voiceHash, textHash);
      const already = await options.readDelivery(
        productionDeliveryKey(publicPath),
      );
      if (already !== undefined) {
        const manifest: unknown = JSON.parse(already);
        if (
          !validateManifest(manifest, text) ||
          manifest.textHash !== textHash ||
          manifest.voiceHash !== voiceHash
        )
          throw new Error(
            'Committed narration manifest does not match the published article',
          );
        continue;
      }
      const requireCurrent = async () => {
        if ((await checkArticle(path)).text !== text) {
          throw new NarrationAttemptUnavailable(
            `Published narration words changed at ${path}`,
          );
        }
      };
      await publishNarrationArticle(
        text,
        {
          ...publication,
          legacyText,
          async beforeSynthesis(characters) {
            if (characters > remaining)
              throw new NarrationAttemptUnavailable(
                'Production narration synthesis budget exhausted',
              );
            await publication.beforeSynthesis?.(characters);
            remaining -= characters;
          },
          beforeSend: requireCurrent,
        },
        {
          writeAudio: (audio, value) =>
            options.deliver(productionDeliveryKey(audio), value, 'audio/wav'),
          async writeManifest(json) {
            await requireCurrent();
            const manifest = JSON.parse(json) as NarrationManifest;
            const committed = JSON.stringify({ ...manifest, voiceHash });
            if (Buffer.byteLength(committed) > 25 * 1024 * 1024)
              throw new Error(
                'Production narration manifest exceeds its serving limit',
              );
            await options.deliver(
              `production-delivery/committed/${manifest.version}.json`,
              JSON.stringify({
                voiceHash,
                textHash,
                chunkCount: manifest.chunks.length,
              }),
              'application/json',
            );
            await requireCurrent();
            await options.deliver(
              productionDeliveryKey(publicPath),
              committed,
              'application/json',
            );
          },
        },
      );
      published++;
    } catch (error) {
      if (error instanceof NarrationAttemptUnavailable)
        options.report?.(error.message);
      else
        failures.push(
          error instanceof Error
            ? error.message
            : 'Production narration recovery failed',
        );
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return { published };
}

function productionDeliveryKey(path: string) {
  return path.replace('/_blog-narration/', 'production-delivery/');
}
