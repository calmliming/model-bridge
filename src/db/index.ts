import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { config } from '../config'
import * as schema from './schema'

const dbPath = resolve(config.DATABASE_PATH)
mkdirSync(dirname(dbPath), { recursive: true })

/** Raw better-sqlite3 handle — used for idempotent table creation. */
export const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

/** Drizzle ORM client used throughout the app. */
export const db = drizzle(sqlite, { schema })
