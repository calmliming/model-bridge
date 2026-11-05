import { getSetting } from '../db/settings'
import { pool } from '../db'

let version = 0
let lastRefresh = 0
let initialized = false
let timer: ReturnType<typeof setInterval> | undefined
let pending: Promise<void> | undefined
export function adminSessionVersion(): number { return version }
export function validAdminSessionVersion(value: unknown): boolean {
  return (value ?? 0) === version && (!initialized || Date.now() - lastRefresh < 10_000)
}
export async function startAdminSessionVersions(): Promise<void> {
  clearInterval(timer)
  const refresh = async () => {
    version = Math.max(version, Number(await getSetting('admin.session_version') ?? 0))
    lastRefresh = Date.now()
    initialized = true
  }
  await refresh()
  timer = setInterval(() => {
    if (!pending) pending = refresh().catch(() => {}).finally(() => { pending = undefined })
  }, 1_000)
  timer.unref()
}
export async function stopAdminSessionVersions(): Promise<void> { clearInterval(timer); await pending }
export async function revokeAdminSessions(): Promise<void> {
  const { rows } = await pool.query(`INSERT INTO settings(key,value) VALUES('admin.session_version','1')
    ON CONFLICT(key) DO UPDATE SET value = ((settings.value::bigint) + 1)::text RETURNING value`)
  version = Number(rows[0]?.value ?? version + 1)
  lastRefresh = Date.now()
}
