import type {
  BrowserVadOptions,
  BrowserVadProviderOptions,
} from './browser-vad.types.js';

const DEFAULT_ASSET_BASE_URL = '/vad-web/';
const DEFAULT_PRE_ROLL_MS = 250;
const MAX_PRE_ROLL_MS = 500;

export type {
  BrowserVadOptions,
  BrowserVadProviderOptions,
} from './browser-vad.types.js';

/**
 * The return type of {@link resolveBrowserVadConfig}: a validated VAD
 * configuration, narrowed by `enabled` so the disabled case carries no
 * settings at all.
 *
 * Discriminate on `enabled` before use — `false` means the caller asked for
 * manual turns, and no assets should be fetched and no worklet created.
 *
 * @example
 * ```ts
 * const config: ResolvedBrowserVadConfig = resolveBrowserVadConfig(input);
 * if (config.enabled) {
 *   await createBrowserVad({ stream, config, startTurn, endTurn, cancelTurn, onFailure });
 * }
 * ```
 */
export type ResolvedBrowserVadConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly assetBaseUrl: string;
      readonly preRollMs: number;
      readonly providerOptions: BrowserVadProviderOptions;
    };

const PROVIDER_OPTION_KEYS = new Set<keyof BrowserVadProviderOptions>([
  'model',
  'positiveSpeechThreshold',
  'negativeSpeechThreshold',
  'redemptionMs',
  'preSpeechPadMs',
  'minSpeechMs',
  'processorType',
  'workletOptions',
]);

/**
 * Resolves adapter-owned VAD configuration before initialization. Runtime
 * values outside `undefined | true | false | BrowserVadOptions`, unsafe
 * asset URLs, and unsupported or malformed provider tuning throw `TypeError`;
 * the adapter converts that setup error into diagnostic manual degradation.
 */
export function resolveBrowserVadConfig(
  vad: unknown,
): ResolvedBrowserVadConfig {
  if (vad === false) return { enabled: false };
  if (vad !== undefined && vad !== true && !isPlainObject(vad)) {
    throw new TypeError('vad must be false, true, or an options object');
  }
  const options =
    vad === undefined || vad === true ? {} : (vad as BrowserVadOptions);
  const assetBaseUrl = normalizeAssetBaseUrl(
    options.assetBaseUrl ?? DEFAULT_ASSET_BASE_URL,
  );
  const preRollMs = options.preRollMs ?? DEFAULT_PRE_ROLL_MS;
  if (
    !Number.isFinite(preRollMs) ||
    preRollMs < 0 ||
    preRollMs > MAX_PRE_ROLL_MS
  ) {
    throw new TypeError('vad.preRollMs must be a finite number from 0 to 500');
  }
  const providerOptions = validateProviderOptions(
    options.providerOptions ?? {},
  );
  return { enabled: true, assetBaseUrl, preRollMs, providerOptions };
}

function normalizeAssetBaseUrl(value: string): string {
  if (
    !value ||
    value !== value.trim() ||
    value.startsWith('//') ||
    value.startsWith('\\')
  ) {
    throw new TypeError(
      'vad.assetBaseUrl must identify a relative or HTTPS directory',
    );
  }
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(value);
  let parsed: URL;
  try {
    parsed = absolute
      ? new URL(value)
      : new URL(value, 'https://maelstrom.invalid/');
  } catch {
    throw new TypeError('vad.assetBaseUrl must be a valid URL directory');
  }
  if (
    (absolute &&
      (parsed.protocol !== 'https:' || !value.startsWith('https://'))) ||
    (!absolute && parsed.origin !== 'https://maelstrom.invalid') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new TypeError(
      'vad.assetBaseUrl must be a relative or credential-free HTTPS directory',
    );
  }
  return value.endsWith('/') ? value : `${value}/`;
}

/**
 * Validates the public tuning allowlist and removes own `undefined` values so
 * MicVAD keeps its defaults. Explicit falsey values, including zero, survive.
 */
function validateProviderOptions(value: unknown): BrowserVadProviderOptions {
  if (!isPlainObject(value)) {
    throw new TypeError('vad.providerOptions must be an object');
  }
  for (const key of Object.keys(value)) {
    if (!PROVIDER_OPTION_KEYS.has(key as keyof BrowserVadProviderOptions)) {
      throw new TypeError(`vad.providerOptions.${key} is not supported`);
    }
  }
  const options = value as BrowserVadProviderOptions;
  if (
    options.model !== undefined &&
    options.model !== 'v5' &&
    options.model !== 'legacy'
  ) {
    throw new TypeError('vad.providerOptions.model is invalid');
  }
  validateRatio(options.positiveSpeechThreshold, 'positiveSpeechThreshold');
  validateRatio(options.negativeSpeechThreshold, 'negativeSpeechThreshold');
  validateNonNegative(options.redemptionMs, 'redemptionMs');
  validateNonNegative(options.preSpeechPadMs, 'preSpeechPadMs');
  validateNonNegative(options.minSpeechMs, 'minSpeechMs');
  if (
    options.processorType !== undefined &&
    !['AudioWorklet', 'ScriptProcessor', 'auto'].includes(options.processorType)
  ) {
    throw new TypeError('vad.providerOptions.processorType is invalid');
  }
  if (
    options.workletOptions !== undefined &&
    !isPlainObject(options.workletOptions)
  ) {
    throw new TypeError('vad.providerOptions.workletOptions must be an object');
  }
  return Object.fromEntries(
    Object.entries(options).filter(([, option]) => option !== undefined),
  ) as BrowserVadProviderOptions;
}

function validateRatio(value: number | undefined, name: string): void {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || value < 0 || value > 1)
  ) {
    throw new TypeError(`vad.providerOptions.${name} must be between 0 and 1`);
  }
}

function validateNonNegative(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new TypeError(
      `vad.providerOptions.${name} must be a non-negative finite number`,
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
