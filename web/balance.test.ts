import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The accounts table decides whether to render a monetary wallet cell or quota
 * windows from its own provider list (the view cannot import the backend module:
 * it is bundled for the browser and pulls in Node-only URL guards). Keep that
 * list aligned with `BALANCE_PROVIDERS` in src/providers/balance.ts.
 */
const BALANCE_PROVIDERS = ['sub2api', 'deepseek'] as const

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

function listedProviders(source: string, declaration: string): string[] {
  const match = source.match(new RegExp(`${declaration}\\s*=\\s*\\[([^\\]]*)\\]`))
  if (!match) throw new Error(`${declaration} declaration not found`)
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((entry) => entry[1]!)
}

describe('balance provider list', () => {
  it('matches the backend balance providers', () => {
    expect(listedProviders(readSource('../src/providers/balance.ts'), 'BALANCE_PROVIDERS'))
      .toEqual([...BALANCE_PROVIDERS])
  })

  it('matches the list used by the accounts table', () => {
    expect(listedProviders(readSource('./src/views/AccountsView.vue'), 'BALANCE_PROVIDER_IDS'))
      .toEqual([...BALANCE_PROVIDERS])
  })
})
