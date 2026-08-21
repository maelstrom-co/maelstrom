/** Logger injected into the Engine; implementations may discard individual levels. */
export interface Logger {
  /** Receives potentially high-volume diagnostic events. */
  debug(message: string, data?: Record<string, unknown>): void;
  /** Receives normal lifecycle and retry events. */
  info(message: string, data?: Record<string, unknown>): void;
  /** Receives recoverable conditions after which processing continues. */
  warn(message: string, data?: Record<string, unknown>): void;
  /** Records a failure, keeping the error separate from correlation data. */
  error(message: string, error?: unknown, data?: Record<string, unknown>): void;
}

const log =
  (level: 'debug' | 'info' | 'warn') =>
  (msg: string, data?: Record<string, unknown>) => {
    const formatted = `[engine] ${msg}`;
    data !== undefined
      ? console[level](formatted, data)
      : console[level](formatted);
  };

/** Prefixes messages with `[engine]` and passes structured values separately. */
export const consoleLogger: Logger = {
  debug: log('debug'),
  info: log('info'),
  warn: log('warn'),
  error(message, error?, data?) {
    const formatted = `[engine] ${message}`;
    const args = [error, data].filter((a) => a !== undefined);
    args.length > 0
      ? console.error(formatted, ...args)
      : console.error(formatted);
  },
};
