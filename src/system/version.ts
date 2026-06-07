import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface SystemVersionInfo {
  version: string | null
  commit: string | null
}

let cachedPackageVersion: string | null | undefined

function readPackageVersion(): string | null {
  if (cachedPackageVersion !== undefined) return cachedPackageVersion

  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown }
    cachedPackageVersion =
      typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : null
  } catch {
    cachedPackageVersion = null
  }

  return cachedPackageVersion
}

function readEnvCommit(): string | null {
  for (const key of ['GIT_COMMIT', 'COMMIT_SHA', 'SOURCE_COMMIT', 'BUILD_COMMIT', 'VCS_REF']) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return null
}

export function getSystemVersionInfo(): SystemVersionInfo {
  return {
    version: readPackageVersion(),
    commit: readEnvCommit(),
  }
}
