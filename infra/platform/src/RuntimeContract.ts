/**
 * Compatibility date every Maelstrom Worker deploys with.
 *
 * Keep aligned with the `@cloudflare/workers-types` catalog entry so the
 * deployed API surface matches the cataloged runtime types.
 */
export const WORKER_COMPATIBILITY_DATE = '2026-07-22';

/**
 * Compatibility flags for Workers that ship an Astro build. Astro 7's Vite 8
 * runtime imports node:module; without this flag workerd rejects the
 * prerender bundle before routes are emitted.
 */
export const ASTRO_WORKER_FLAGS = ['nodejs_compat'];
