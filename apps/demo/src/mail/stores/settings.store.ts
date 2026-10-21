import { useSyncExternalStore } from 'react';

export const TEXT_SIZES = ['small', 'medium', 'large', 'extra-large'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const THEMES = ['light', 'dark', 'sepia'] as const;
export type MailTheme = (typeof THEMES)[number];

export const TEXT_SIZE_DIRECTIONS = ['bigger', 'smaller'] as const;
export type TextSizeDirection = (typeof TEXT_SIZE_DIRECTIONS)[number];

export interface VacationReply {
  readonly on: boolean;
  readonly message: string;
}

export interface MailboxStorage {
  readonly usedMb: number;
  readonly totalMb: number;
}

export interface SettingsState {
  readonly textSize: TextSize;
  readonly theme: MailTheme;
  readonly notificationsOn: boolean;
  readonly soundOn: boolean;
  readonly readReceipts: boolean;
  readonly remoteImages: boolean;
  readonly blockedSenders: readonly string[];
  readonly signature: string;
  readonly vacationReply: VacationReply;
  readonly storage: MailboxStorage;
}

const listeners = new Set<() => void>();
let state: SettingsState = initialSettingsState();

export function useSettingsStore(): SettingsState {
  return useSyncExternalStore(
    subscribe,
    getSettingsSnapshot,
    getSettingsSnapshot,
  );
}

export function getSettingsSnapshot(): SettingsState {
  return state;
}

export function isTextSize(value: string): value is TextSize {
  return (TEXT_SIZES as readonly string[]).includes(value);
}

export function isMailTheme(value: string): value is MailTheme {
  return (THEMES as readonly string[]).includes(value);
}

export function isTextSizeDirection(value: string): value is TextSizeDirection {
  return (TEXT_SIZE_DIRECTIONS as readonly string[]).includes(value);
}

export function __resetSettingsStoreForTests(): void {
  update(initialSettingsState());
}

export const settingsActions = {
  setTextSize(textSize: TextSize): void {
    update({ textSize });
  },
  adjustTextSize(direction: TextSizeDirection): TextSize {
    const index = TEXT_SIZES.indexOf(state.textSize);
    const step = direction === 'bigger' ? 1 : -1;
    const nextIndex = Math.min(
      TEXT_SIZES.length - 1,
      Math.max(0, index + step),
    );
    const textSize = TEXT_SIZES[nextIndex] ?? state.textSize;
    update({ textSize });
    return textSize;
  },
  setTheme(theme: MailTheme): void {
    update({ theme });
  },
  setEmailNotifications(notificationsOn: boolean): void {
    update({ notificationsOn });
  },
  setSound(soundOn: boolean): void {
    update({ soundOn });
  },
  setReadReceipts(readReceipts: boolean): void {
    update({ readReceipts });
  },
  setRemoteImages(remoteImages: boolean): void {
    update({ remoteImages });
  },
  blockSender(email: string): boolean {
    const address = normalizeAddress(email);
    if (!address) return false;
    if (!state.blockedSenders.includes(address)) {
      update({ blockedSenders: [...state.blockedSenders, address] });
    }
    return true;
  },
  unblockSender(email: string): boolean {
    const address = normalizeAddress(email);
    if (!state.blockedSenders.includes(address)) return false;
    update({
      blockedSenders: state.blockedSenders.filter(
        (blocked) => blocked !== address,
      ),
    });
    return true;
  },
  setSignature(signature: string): void {
    update({ signature });
  },
  setVacationReply(on: boolean, message?: string): void {
    update({
      vacationReply: {
        on,
        message: message?.trim() ? message : state.vacationReply.message,
      },
    });
  },
};

function initialSettingsState(): SettingsState {
  return {
    textSize: 'medium',
    theme: 'light',
    notificationsOn: true,
    soundOn: true,
    readReceipts: true,
    remoteImages: true,
    blockedSenders: [
      'prizes@win-a-cruise.example',
      'deals@cheap-pills.example',
    ],
    signature: 'Sent from my Mail',
    vacationReply: {
      on: false,
      message: 'Thanks for your note. I am away and will reply when I am back.',
    },
    storage: { usedMb: 3_420, totalMb: 15_360 },
  };
}

function normalizeAddress(email: string): string {
  return email.trim().toLowerCase();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(patch: Partial<SettingsState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
