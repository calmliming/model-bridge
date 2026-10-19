import { open, mkdir, rename, unlink, opendir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { encrypt, decrypt } from '../crypto'

export interface QueueEntry<T> { version: 1; id: string; payload: T; attempts: number; nextAttemptAt: number }

/** Password rotation keeps the same ledger; a different database/schema gets its own queue. */
export function usageOutboxNamespace(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.password = ''
  url.protocol = 'postgresql:'
  return createHash('sha256').update(url.toString()).digest('hex').slice(0, 16)
}

/** Encrypted atomic files remain available independently of PostgreSQL. */
export class DurableQueue<T> {
  constructor(readonly directory: string) {}

  async init(): Promise<void> { await mkdir(this.directory, { recursive: true, mode: 0o700 }) }

  private async syncDirectory(): Promise<void> {
    const handle = await open(this.directory, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }

  private path(id: string): string {
    if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('Invalid usage outbox ID')
    return join(this.directory, `${id}.pending`)
  }

  private async write(entry: QueueEntry<T>): Promise<void> {
    await this.init()
    const target = this.path(entry.id)
    const temporary = join(this.directory, `.${entry.id}.${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(encrypt(JSON.stringify(entry)), 'utf8'); await handle.sync() }
      finally { await handle.close() }
      await rename(temporary, target)
      await this.syncDirectory()
    } finally { await unlink(temporary).catch(() => {}) }
  }

  async put(id: string, payload: T): Promise<void> {
    await this.write({ version: 1, id, payload, attempts: 0, nextAttemptAt: 0 })
  }

  async ack(id: string): Promise<void> {
    try { await unlink(this.path(id)); await this.syncDirectory() }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }

  async defer(entry: QueueEntry<T>, now = Date.now()): Promise<void> {
    await this.write({ ...entry, attempts: entry.attempts + 1,
      nextAttemptAt: now + Math.min(300_000, 30_000 * 2 ** Math.min(4, entry.attempts)) })
  }

  async pending(now = Date.now(), limit = 100): Promise<QueueEntry<T>[]> {
    await this.init()
    const entries: QueueEntry<T>[] = []
    for await (const file of await opendir(this.directory)) {
      if (!file.isFile() || !/^[a-f0-9]{24}\.pending$/.test(file.name)) continue
      try {
        const entry = JSON.parse(decrypt(await readFile(join(this.directory, file.name), 'utf8'))) as QueueEntry<T>
        if (entry.version !== 1 || `${entry.id}.pending` !== file.name || !entry.payload
          || !Number.isFinite(entry.nextAttemptAt) || !Number.isInteger(entry.attempts)) throw new Error('Invalid usage outbox entry')
        if (entry.nextAttemptAt <= now) entries.push(entry)
        if (entries.length >= limit) break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[usage-outbox] unreadable entry retained:', file.name)
      }
    }
    return entries
  }
}
