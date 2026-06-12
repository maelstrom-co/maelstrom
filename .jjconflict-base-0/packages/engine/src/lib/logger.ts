export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
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
