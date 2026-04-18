declare const brand: unique symbol;

export type Brand<T, B extends string> = T & {
  readonly [brand]: B;
};

/**
 * Throws if `value` is empty or whitespace-only. Shared guard used by every
 * branded-string smart constructor so the non-empty invariant lives in one
 * place — adding a fourth branded ID inherits the same rule for free.
 */
export const requireNonEmptyBrand = (value: string, brandName: string): void => {
  if (value.trim() === '') {
    throw new Error(
      `${brandName}("") is not allowed. Pass a non-empty string.`,
    );
  }
};
