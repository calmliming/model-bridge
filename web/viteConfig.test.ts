import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadConfigFromFile } from 'vite'
import { expect, it } from 'vitest'

it('loads the frontend build config with only the web manifest, as in Docker', async () => {
  const prefix = join(tmpdir(), 'model-bridge-web-config-')
  const fixture = mkdtempSync(prefix)
  const webDir = join(fixture, 'web')
  try {
    mkdirSync(webDir)
    copyFileSync(resolve('web/vite.config.ts'), join(webDir, 'vite.config.ts'))
    copyFileSync(resolve('web/package.json'), join(webDir, 'package.json'))
    symlinkSync(resolve('web/node_modules'), join(webDir, 'node_modules'), 'junction')
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' }, join(webDir, 'vite.config.ts'), webDir, 'silent',
    )
    const manifest = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8'))
    expect(loaded?.config.define?.['import.meta.env.VITE_APP_VERSION']).toBe(JSON.stringify(manifest.version))
  } finally {
    if (resolve(fixture).startsWith(resolve(prefix))) rmSync(fixture, { recursive: true, force: true })
  }
})
