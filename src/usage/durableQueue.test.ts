import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DurableQueue, usageOutboxNamespace } from './durableQueue'

describe('durable encrypted usage queue', () => {
  let directory: string
  const id = 'a'.repeat(24)
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'usage-outbox-qa-')) })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('survives a new queue instance and keeps request contents encrypted on disk', async () => {
    await new DurableQueue(directory).put(id, { prompt: 'private request', cost: 1.25 })
    const files = await readdir(directory)
    expect(files).toEqual([`${id}.pending`])
    expect(await readFile(join(directory, files[0]!), 'utf8')).not.toContain('private request')
    expect((await stat(join(directory, files[0]!))).mode & 0o777).toBe(0o600)
    const queue = new DurableQueue(directory)
    expect((await queue.pending())[0]!.payload).toEqual({ prompt: 'private request', cost: 1.25 })
    await queue.ack(id)
    await queue.ack(id)
    expect(await queue.pending()).toEqual([])
  })

  it('persists bounded exponential retry backoff without dropping the record', async () => {
    const queue = new DurableQueue(directory)
    await queue.put(id, { cost: 1 })
    let entry = (await queue.pending())[0]!
    for (let i = 0; i < 8; i++) {
      const now = 1_000_000 * (i + 1)
      await queue.defer(entry, now)
      expect(await queue.pending(now)).toEqual([])
      entry = (await new DurableQueue(directory).pending(now + 300_000))[0]!
      expect(entry.attempts).toBe(i + 1)
      expect(entry.nextAttemptAt - now).toBe(Math.min(300_000, 30_000 * 2 ** i))
    }
  })

  it('retains corrupt entries and continues recovering valid records', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await writeFile(join(directory, `${id}.pending`), 'corrupt')
      const queue = new DurableQueue(directory)
      await queue.put('b'.repeat(24), { cost: 2 })
      expect((await queue.pending()).map(entry => entry.id)).toEqual(['b'.repeat(24)])
      expect(await readFile(join(directory, `${id}.pending`), 'utf8')).toBe('corrupt')
      expect(log).toHaveBeenCalled()
    } finally { log.mockRestore() }
  })

  it('isolates databases while surviving password rotation', () => {
    const first = usageOutboxNamespace('postgres://test:old@localhost:5432/billing')
    expect(usageOutboxNamespace('postgresql://test:new@localhost:5432/billing')).toBe(first)
    expect(usageOutboxNamespace('postgresql://test:new@localhost:5432/billing_test')).not.toBe(first)
    expect(usageOutboxNamespace('postgresql://test:new@localhost:5432/billing?options=-c%20search_path%3Dqa')).not.toBe(first)
  })

  it('rejects invalid entry identifiers', async () => {
    await expect(new DurableQueue(directory).put('../outside', { cost: 1 })).rejects.toThrow('Invalid usage outbox ID')
  })
})
