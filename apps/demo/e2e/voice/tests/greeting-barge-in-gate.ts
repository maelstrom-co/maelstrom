import { bargeInPolicy } from './barge-in-measurement.ts';
import type { AssistantAudioActivity } from './shared-audio-capture.ts';

export const greetingBargeInMinimumActiveMs = 100;

export function isGreetingBargeInReady(
  activity: Pick<AssistantAudioActivity, 'activeMs' | 'silentTailMs'>,
): boolean {
  return (
    Number.isFinite(activity.activeMs) &&
    Number.isFinite(activity.silentTailMs) &&
    activity.activeMs >= greetingBargeInMinimumActiveMs &&
    activity.silentTailMs >= 0 &&
    activity.silentTailMs <= bargeInPolicy.maximumPreOnsetQuietMs
  );
}
