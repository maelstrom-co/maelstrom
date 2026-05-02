// Internal type-system glue for schema-vs-interface drift checks. Underscore
// prefix marks the module as not re-exported from the package barrel.

/**
 * Primitive type-set used by `Mutable<T>` to short-circuit recursion before
 * the object branch. Without this, branded types like
 * `InstanceId = string & { [brand]: 'InstanceId' }` would satisfy
 * `T extends object` and `Mutable<InstanceId>` would expand into a mapped
 * type over all `string` prototype keys, becoming incompatible with both
 * `string` and `InstanceId`.
 */
export type _Primitive =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined;

/**
 * Strips `readonly` from every nested position of `T`. Used by drift guards
 * to compare hand-written interfaces (deeply `readonly`) against Zod's
 * inferred shape (which does not synthesize `readonly`).
 */
export type Mutable<T> = T extends _Primitive
  ? T
  : T extends ReadonlyArray<infer U>
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Mutable<T[K]> }
      : T;
