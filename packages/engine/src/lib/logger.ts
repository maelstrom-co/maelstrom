/** Structured logging contract consumed by the Engine. */
export interface Logger {
  /** Records diagnostic detail with optional structured data. */
  debug(message: string, data?: Record<string, unknown>): void;
  /** Records normal lifecycle information with optional structured data. */
  info(message: string, data?: Record<string, unknown>): void;
  /** Records a recoverable concern with optional structured data. */
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

/** Console-backed logger that prefixes every message with `[engine]`. */
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
