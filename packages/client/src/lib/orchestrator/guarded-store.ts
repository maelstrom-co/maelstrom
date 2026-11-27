import { type Observer, Store, type Subscription } from '@tanstack/store';

// TanStack stops notifying at the first subscriber that throws, so each
// subscriber is guarded before the store sees it.
export class GuardedStore<T> extends Store<T> {
  readonly #onSubscriberError: (error: unknown) => void;

  constructor(initialValue: T, onSubscriberError: (error: unknown) => void) {
    super(initialValue);
    this.#onSubscriberError = onSubscriberError;
  }

  override subscribe(
    observerOrFn: Observer<T> | ((value: T) => void),
  ): Subscription {
    const observer =
      typeof observerOrFn === 'function'
        ? { next: observerOrFn }
        : observerOrFn;
    return super.subscribe({
      error: (error) => observer.error?.(error),
      complete: () => observer.complete?.(),
      next: (value) => {
        try {
          observer.next?.(value);
        } catch (error) {
          this.#onSubscriberError(error);
        }
      },
    });
  }
}
