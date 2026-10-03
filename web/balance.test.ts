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

/**
 * Providers with neither a wallet nor quota endpoint keep their own list, so the
 * column can state that instead of offering a refresh that never fills it.
 */
const NO_USAGE_ENDPOINT_PROVIDERS = ['grsai'] as const

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

describe('providers without a usage endpoint', () => {
  it('matches the backend list', () => {
    expect(listedProviders(readSource('../src/providers/balance.ts'), 'NO_USAGE_ENDPOINT_PROVIDERS'))
      .toEqual([...NO_USAGE_ENDPOINT_PROVIDERS])
  })

  it('matches the list used by the accounts table', () => {
    expect(listedProviders(readSource('./src/views/AccountsView.vue'), 'NO_USAGE_ENDPOINT_PROVIDER_IDS'))
      .toEqual([...NO_USAGE_ENDPOINT_PROVIDERS])
  })

  it('renders an explicit state instead of the never-filled quota cell', () => {
    const source = readSource('./src/views/AccountsView.vue')
    expect(source).toContain("if (lacksUsageEndpoint(row.provider)) return renderNoUsageEndpoint()")
    expect(source).toContain('该渠道不提供余额查询')
    // The row's actions column already offers 测试连通性; the cell stays text-only.
    expect(source).not.toContain('quota-endpoint-test')
  })
})
