import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/waitlist-schema.ts',
  out: './drizzle/migrations',
});
