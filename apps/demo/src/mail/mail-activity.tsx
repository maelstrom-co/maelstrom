import { useFlashInstances } from '../lib/use-touched-instances';
import { mailM } from './maelstrom';

/** True while an engine request is in flight or the voice assistant is thinking. */
export function useMailWorking(): boolean {
  const isProcessing = mailM.useMaelstrom((state) => state.isProcessing);
  const { state: voiceState } = mailM.useVoice();
  return isProcessing || voiceState === 'thinking';
}

/**
 * Flags the vessels the assistant just changed with `data-flash` so the mail
 * styles can play a one-shot highlight on them.
 */
export function MailActionFlash() {
  useFlashInstances(mailM.useTouchedInstances());
  return null;
}
