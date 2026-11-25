import {
  extractNarration,
  isNarrationHash,
  narrationDigest,
  narrationManifestPath,
  narrationMediaPath,
  validateManifest,
  type WordTiming,
} from './blog-narration';

function currentWord(words: WordTiming[], time: number) {
  let low = 0;
  let high = words.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (words[middle].start <= time) low = middle + 1;
    else high = middle;
  }
  const word = words[low - 1];
  return word && time < word.end ? word : undefined;
}

const clock = (time: number) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;

async function setup(player: HTMLElement) {
  const audio = player.querySelector('audio');
  const toggle = player.querySelector('button');
  const seek = player.querySelector('input');
  const timeLabel = player.querySelector('output');
  const status = player.querySelector('[role="status"]');
  const configuredVoice = player.dataset.narrationVoice;
  const assets = player.dataset.narrationAssets;
  const voice =
    !assets && isNarrationHash(configuredVoice) ? configuredVoice : undefined;
  const { text, range } = extractNarration(document);
  const textHash = await narrationDigest(text);
  const manifestUrl = voice
    ? narrationManifestPath(voice, textHash)
    : player.dataset.narrationPlayer;
  if (!audio || !toggle || !seek || !timeLabel || !status || !manifestUrl)
    return;

  const response = await fetch(
    manifestUrl,
    assets || voice
      ? { cache: 'no-store', credentials: 'omit', redirect: 'error' }
      : undefined,
  );
  if (!response.ok) return;
  const manifest: unknown = await response.json();
  if (
    !validateManifest(manifest, text) ||
    textHash !== manifest.textHash ||
    (voice !== undefined && manifest.voiceHash !== voice)
  )
    return;

  if (assets) audio.crossOrigin = 'anonymous';
  const highlights =
    typeof Highlight === 'function' ? new Highlight() : undefined;
  if (highlights) CSS.highlights.set('narrated-word', highlights);

  let duration = 0;
  const chunks = manifest.chunks.map((chunk) => {
    const offset = duration;
    duration += chunk.duration;
    return { ...chunk, offset };
  });
  let index = -1;
  let pendingTime: number | undefined;
  let wantsPlay = false;
  let frame = 0;
  let active: WordTiming | undefined;

  const sync = () => {
    const chunk = chunks[index];
    if (!chunk) return;
    const position = pendingTime ?? audio.currentTime;
    const time = chunk.offset + position;
    seek.value = String(time);
    seek.setAttribute('aria-valuetext', `${clock(time)} of ${clock(duration)}`);
    timeLabel.value = `${clock(time)} / ${clock(duration)}`;
    const word =
      pendingTime === undefined && !audio.ended
        ? currentWord(chunk.words, position)
        : undefined;
    if (word === active) return;
    active = word;
    highlights?.clear();
    const selected = word && range(word.from, word.to);
    if (selected) highlights?.add(selected);
  };

  const tick = () => {
    sync();
    if (!audio.paused) frame = requestAnimationFrame(tick);
  };

  const updatePlay = (next: boolean) => {
    wantsPlay = next;
    toggle.textContent = next ? 'Pause narration' : 'Play narration';
  };

  const fail = () => {
    updatePlay(false);
    audio.pause();
    cancelAnimationFrame(frame);
    highlights?.clear();
    status.textContent = 'Narration is unavailable.';
    toggle.disabled = true;
    seek.disabled = true;
  };

  const play = () => {
    const src = audio.src;
    void audio.play().catch((error: unknown) => {
      if (
        audio.src === src &&
        wantsPlay &&
        !(error instanceof DOMException && error.name === 'AbortError')
      )
        fail();
    });
  };

  const changeChunk = (next: number, position: number) => {
    index = next;
    pendingTime = position;
    const mediaPath = narrationMediaPath(manifest.version, next);
    audio.src = assets ? new URL(mediaPath.slice(1), assets).href : mediaPath;
    sync();
  };

  const goTo = (time: number) => {
    const next = chunks.findLastIndex((chunk) => chunk.offset <= time);
    const position = time - chunks[next].offset;
    if (index !== next) {
      changeChunk(next, position);
    } else if (pendingTime !== undefined) {
      pendingTime = position;
      sync();
    } else {
      audio.currentTime = position;
      sync();
    }
  };

  toggle.addEventListener('click', () => {
    if (wantsPlay) {
      updatePlay(false);
      audio.pause();
      return;
    }
    updatePlay(true);
    if (index < 0 || audio.ended) {
      goTo(0);
    }
    if (pendingTime === undefined || pendingTime === 0) play();
  });

  seek.addEventListener('input', () => goTo(seek.valueAsNumber));
  audio.addEventListener('loadedmetadata', () => {
    if (pendingTime !== undefined) {
      audio.currentTime = Math.min(pendingTime, audio.duration);
      pendingTime = undefined;
    }
    if (wantsPlay) play();
    sync();
  });
  audio.addEventListener('playing', () => {
    cancelAnimationFrame(frame);
    tick();
  });
  for (const event of ['pause', 'seeked', 'timeupdate']) {
    audio.addEventListener(event, sync);
  }
  audio.addEventListener('ended', () => {
    if (wantsPlay && index + 1 < chunks.length) {
      changeChunk(index + 1, 0);
      play();
    } else {
      updatePlay(false);
      sync();
    }
  });
  audio.addEventListener('error', fail);
  seek.max = String(duration);
  seek.setAttribute('aria-valuetext', `0:00 of ${clock(duration)}`);
  timeLabel.value = `0:00 / ${clock(duration)}`;
  player.hidden = false;
}

const player = document.querySelector<HTMLElement>('[data-narration-player]');
if (player) void setup(player).catch(() => {});
