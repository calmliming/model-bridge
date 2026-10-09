import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Execute the actual snippet computation so the tests cover the emitted config,
// including TOML section placement, without mounting the dashboard or calling APIs.
const source = readFileSync(new URL('./src/views/ApiKeysView.vue', import.meta.url), 'utf8')
const start = source.indexOf('const snippets = computed(')
const end = source.indexOf('// CC Switch one-click import picker state', start)
if (start < 0 || end < 0) throw new Error('API key snippet computation not found')
const generate = new Function('computed', 'useKeySecret', 'codexRemoteCatalog', 'baseOrigin',
  `${source.slice(start, end)}\nreturn snippets.codex`) as (
    computed: (fn: () => unknown) => unknown,
    key: { value: string }, remote: { value: boolean }, origin: { value: string },
  ) => string

function config(remote: boolean): string {
  return generate(fn => fn(), { value: 'mb-test' }, { value: remote }, { value: 'https://bridge.example.com' })
}

function sectionLines(snippet: string, name: string): string[] {
  let section = ''
  const lines: string[] = []
  for (const line of snippet.split('\n')) {
    if (line.startsWith('export ')) break
    const heading = /^\[([^\]]+)\]$/.exec(line)
    if (heading) section = heading[1]!
    else if (section === name && line.trim()) lines.push(line)
  }
  return lines
}

describe('Codex API key config', () => {
  it('enables API-key discovery in the features section when using the remote catalog', () => {
    const snippet = config(true)
    expect(sectionLines(snippet, 'features')).toContain('api_key_model_discovery = true')
    const provider = sectionLines(snippet, 'model_providers.model-bridge')
    expect(provider).toContain('model_catalog_url = "https://bridge.example.com/v1/models"')
    expect(provider).toContain('env_key = "MODEL_BRIDGE_API_KEY"')
    expect(provider).toContain('requires_openai_auth = false')
    expect(provider).not.toContain('api_key_model_discovery = true')
    expect(snippet).toContain('export MODEL_BRIDGE_API_KEY=mb-test')
  })

  it('keeps bundled catalog configuration free of the discovery option', () => {
    const snippet = config(false)
    expect(snippet).not.toContain('model_catalog_url')
    expect(snippet).not.toContain('api_key_model_discovery')
    expect(sectionLines(snippet, 'features')).toEqual([])
    expect(sectionLines(snippet, 'model_providers.model-bridge')).toContain('env_key = "MODEL_BRIDGE_API_KEY"')
  })
})
