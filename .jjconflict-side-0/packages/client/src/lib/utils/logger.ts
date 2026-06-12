/**
 * Logger class for Maelstrom client debugging.
 *
 * Provides namespaced logging with optional debug output.
 * Warnings and errors are always logged regardless of enabled state.
 *
 * @example
 * ```typescript
 * const logger = new Logger(true); // Enable debug logging
 * logger.info('Processing message'); // Outputs: [Maelstrom] Processing message
 * ```
 */
export class Logger {
  #enabled: boolean;
  #prefix: string;

  /**
   * Creates a new Logger instance.
   *
   * @param enabled - Whether debug/info logs should be output (default: false)
   * @param namespace - Optional namespace prefix (default: 'Maelstrom')
   */
  constructor(enabled: boolean = false, namespace: string = 'Maelstrom') {
    this.#enabled = enabled;
    this.#prefix = `[${namespace}]`;
  }

  /**
   * Check if logging is enabled.
   */
  get isEnabled(): boolean {
    return this.#enabled;
  }

  /**
   * Enable or disable logging (excluding errors).
   */
  setEnabled(value: boolean): void {
    this.#enabled = value;
  }

  /**
   * Log debug message (only if enabled).
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.#enabled) {
      console.debug(this.#prefix, message, ...args);
    }
  }

  /**
   * Log info message (only if enabled).
   */
  info(message: string, ...args: unknown[]): void {
    if (this.#enabled) {
      console.log(this.#prefix, message, ...args);
    }
  }

  /**
   * Log warning message (always logged regardless of enabled state).
   */
  warn(message: string, ...args: unknown[]): void {
    // Always log warnings regardless of enabled state
    console.warn(this.#prefix, message, ...args);
  }

  /**
   * Log error message (always logged regardless of enabled state).
   */
  error(message: string, ...args: unknown[]): void {
    // Always log errors regardless of enabled state
    console.error(this.#prefix, message, ...args);
  }
}
