/**
 * Resolve/reject-from-outside primitive. Lets tests gate async work on
 * observable events instead of guessing microtask counts.
 */
export const defer = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
