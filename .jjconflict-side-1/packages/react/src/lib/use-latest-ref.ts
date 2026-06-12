import { type RefObject, useRef } from 'react';

/** Returns a ref that always holds the latest value, updated synchronously on each render. */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
