import { defineConfig } from 'drizzle-kit'

// Drizzle Kit config — used for `npm run db:generate` to produce SQL
// migrations. At runtime the app creates tables idempotently via
// src/db/init.ts, so the app boots with zero migration steps.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? './data/model-bridge.db',
  },
})
