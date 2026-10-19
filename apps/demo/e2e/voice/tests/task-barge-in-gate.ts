import type { BargeInObserverSnapshot } from './barge-in-observer.ts';
import type { AssistantAudioActivity } from './shared-audio-capture.ts';

export const taskBargeInMinimumActiveMs = 100;

export type TaskBargeInGate = {
  readonly responseId: string;
  readonly responseStartedFrame: number;
  readonly playbackMarkerFrame: number;
  readonly activeMs: number;
  readonly silentTailMs: number;
  readonly observedFrame: number | null;
  readonly lastActiveFrame: number | null;
};

export async function sampleTaskBargeInGate(args: {
  readonly primerFrame: number;
  readonly minimumActiveMs: number;
  readonly maximumQuietMs: number;
}): Promise<TaskBargeInGate | null> {
  const target = window as Window & {
    __voiceAudioTimeline?: {
      mark(): Promise<number>;
      assistantMonitor(frame: number): Promise<AssistantAudioActivity>;
    };
    __voiceBargeInObserver?: { snapshot(): BargeInObserverSnapshot };
  };
  const timeline = target.__voiceAudioTimeline;
  const observer = target.__voiceBargeInObserver;
  if (!timeline || !observer)
    throw new Error('Task-response audio/lifecycle hooks are unavailable.');
  const current = () => {
    const snapshot = observer.snapshot();
    if (snapshot.dropped)
      throw new Error('Task-response lifecycle evidence was truncated.');
    const event = [...snapshot.events]
      .reverse()
      .find(
        (event) =>
          event.type === 'output_audio_buffer.started' &&
          event.frame >= args.primerFrame,
      );
    if (!event?.responseId) return null;
    if (
      snapshot.events.some(
        (candidate) =>
          candidate.responseId === event.responseId &&
          candidate.frame >= event.frame &&
          (candidate.type === 'output_audio_buffer.stopped' ||
            candidate.type === 'output_audio_buffer.cleared'),
      )
    )
      return null;
    return { ...event, responseId: event.responseId };
  };
  const response = current();
  if (!response) return null;
  const ready = (activity: AssistantAudioActivity) =>
    Number.isFinite(activity.activeMs) &&
    Number.isFinite(activity.silentTailMs) &&
    activity.activeMs >= args.minimumActiveMs &&
    activity.silentTailMs >= 0 &&
    activity.silentTailMs <= args.maximumQuietMs;
  if (!ready(await timeline.assistantMonitor(response.frame))) return null;
  const marker = await timeline.mark();
  if (!Number.isSafeInteger(marker) || marker < 0)
    throw new Error('Task-response playback marker is invalid.');
  const activity = await timeline.assistantMonitor(response.frame);
  const latest = current();
  if (
    !ready(activity) ||
    latest?.responseId !== response.responseId ||
    latest.frame !== response.frame
  )
    return null;
  return {
    responseId: response.responseId,
    responseStartedFrame: response.frame,
    playbackMarkerFrame: marker,
    activeMs: activity.activeMs,
    silentTailMs: activity.silentTailMs,
    observedFrame: activity.currentFrame ?? null,
    lastActiveFrame: activity.lastActiveFrame ?? null,
  };
}
