export function notifyObserver<Value>(
  listener: (value: Value) => unknown,
  value: Value,
): void {
  try {
    const result = listener(value);
    if (
      result !== null &&
      (typeof result === 'object' || typeof result === 'function') &&
      'then' in result
    )
      void Promise.resolve(result).catch(() => {});
  } catch {
    /* Optional observation must not interrupt application work. */
  }
}
