import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit configuration for the Cloudflare D1 database.
 *
 * Migrations are generated from src/lib/db/schema.ts into ./drizzle, then
 * applied to D1 with wrangler:
 *   bun db:generate
 *   bun db:migrate:local
 *   bun db:migrate:remote
 */
export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
})
