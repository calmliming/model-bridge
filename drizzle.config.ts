import { defineConfig } from 'drizzle-kit'
import { config as loadDotenv } from 'dotenv'

loadDotenv()

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for drizzle-kit (set it in .env)')
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
})
