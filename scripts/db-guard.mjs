#!/usr/bin/env node
// Guard wrapper for drizzle-kit. Refuses to run schema-modifying commands
// against a remote database without explicit "YES" confirmation, so that
// `npm run db:generate` when DATABASE_URL points to production doesn't
// silently rewrite the live schema.

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { config as loadDotenv } from 'dotenv'

loadDotenv()

const subcommand = process.argv[2]
if (!subcommand) {
  console.error('usage: db-guard.mjs <drizzle-kit-subcommand> [...args]')
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[db-guard] DATABASE_URL is not set')
  process.exit(1)
}

let host
try {
  host = new URL(url).hostname
} catch {
  console.error('[db-guard] DATABASE_URL is not a valid URL')
  process.exit(1)
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])
const looksProd =
  !LOCAL_HOSTS.has(host) || /prod|production/i.test(url)

if (looksProd) {
  console.warn('')
  console.warn('╔══════════════════════════════════════════════════════════╗')
  console.warn('║  ⚠️  About to run drizzle-kit against a non-local DB     ║')
  console.warn('╚══════════════════════════════════════════════════════════╝')
  console.warn(`  subcommand:  drizzle-kit ${subcommand}`)
  console.warn(`  host:        ${host}`)
  console.warn(`  NODE_ENV:    ${process.env.NODE_ENV ?? '(unset)'}`)
  console.warn('  This may modify the production schema. Type YES to proceed.')
  console.warn('')

  const rl = createInterface({ input: stdin, output: stdout })
  const answer = (await rl.question('> ')).trim()
  rl.close()
  if (answer !== 'YES') {
    console.error('[db-guard] aborted (expected exact input: YES)')
    process.exit(1)
  }
}

const args = ['drizzle-kit', subcommand, ...process.argv.slice(3)]
// `npx` is `npx.cmd` on Windows and is only resolvable through the shell's
// PATHEXT lookup, so spawn via the shell for cross-platform compatibility.
const child = spawn('npx', args, { stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
