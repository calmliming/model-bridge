import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The API docs are one long template: navigation items, section branches and
 * anchors live in the same file, so a rename can silently produce a nav entry
 * that renders nothing or a link that lands on the overview. These checks keep
 * the parts (navigation, sections, per-model pages, legacy anchors) aligned
 * without pulling Vue into the test.
 *
 * Structure contract: text models are documented per protocol (plus one
 * comparison table), while every image and video model gets its own page,
 * because those vendors disagree on required fields, size rules and how the
 * result is fetched.
 */
const CAPABILITY_GROUPS = ['开始使用', '文本模型', '图片模型', '视频模型', '通用说明']

function readDocs(): string {
  return readFileSync(fileURLToPath(new URL('./src/views/ApiDocsView.vue', import.meta.url)), 'utf8')
}

/** Every configured navigation entry, in order. */
function navigationIds(source: string): string[] {
  return [...source.matchAll(/\{ id: '([a-z0-9-]+)', label:/g)].map((match) => match[1]!)
}

/** Every explicit `activeSection === '…'` branch in the template. */
function sectionIds(source: string): string[] {
  return [...source.matchAll(/activeSection === '([a-z0-9-]+)'/g)].map((match) => match[1]!)
}

/** Section ids declared by the per-model pages' data entries. */
function mediaModelSections(source: string): string[] {
  return [...source.matchAll(/section: '([a-z0-9-]+)', modelId/g)].map((match) => match[1]!)
}

/** Media models the platform actually serves, from the provider model list. */
function servedModelIds(): string[] {
  const models = readFileSync(fileURLToPath(new URL('../src/providers/grsai/models.ts', import.meta.url)), 'utf8')
  const image = models.match(/GRSAI_IMAGE_MODELS = \[([^\]]*)\]/)?.[1] ?? ''
  const video = models.match(/GRSAI_MODELS = \[([^\]]*)\]/)?.[1] ?? ''
  const ids = [...`${image},${video}`.matchAll(/'([a-z0-9.-]+)'/g)].map((match) => match[1]!)
  return [...new Set(ids)]
}

describe('API docs structure', () => {
  const source = readDocs()
  const navIds = navigationIds(source)
  const sections = new Set(sectionIds(source))

  it('keeps the five navigation groups', () => {
    for (const label of CAPABILITY_GROUPS) expect(source).toContain(`label: '${label}'`)
  })

  it('renders a section for every navigation entry', () => {
    // Per-model pages are rendered by the shared `activeImageModel` /
    // `activeVideoModel` blocks instead of their own `activeSection ===` branch.
    const modelSections = new Set(mediaModelSections(source))
    expect(navIds.filter((id) => !sections.has(id) && !modelSections.has(id))).toEqual([])
  })

  it('has no section that navigation cannot reach', () => {
    expect([...sections].filter((id) => !navIds.includes(id))).toEqual([])
  })

  it('renders every per-model page from the media model data', () => {
    // The template has one shared block per capability that reads
    // `activeImageModel` / `activeVideoModel`, so each model needs both a data
    // entry and a navigation entry.
    expect(source).toContain('v-else-if="activeImageModel"')
    expect(source).toContain('v-else-if="activeVideoModel"')
    const modelSections = mediaModelSections(source)
    expect(modelSections.length).toBeGreaterThanOrEqual(6)
    expect(modelSections.filter((id) => !navIds.includes(id))).toEqual([])
  })

  it('documents every image and video model the platform serves', () => {
    const documented = [...source.matchAll(/modelId: '([^']+)'/g)].map((match) => match[1]!)
    expect([...documented].sort()).toEqual(servedModelIds().sort())
  })

  it('documents text models per protocol with a comparison table', () => {
    expect(navIds).toContain('text-chat')
    expect(navIds).toContain('text-messages')
    expect(navIds).toContain('text-gemini')
    expect(navIds).toContain('text-models')
    expect(source).toContain('const textModelRows')
    expect(source).toContain('/v1/chat/completions')
  })

  it('keeps the published media-generation anchor working', () => {
    // DocsView links to the docs and older pages linked to #media-generation.
    expect(source).toContain("'media-generation': 'video-generation'")
    expect(source).toContain('legacySectionAliases[value]')
  })

  it('documents the verified media constraints instead of the old OpenAI defaults', () => {
    expect(source).toContain('n 大于 1 会返回 400')
    expect(source).not.toContain('partial_images 可以请求最多 3 张中间图')
    expect(source).not.toContain('生成数量，范围为 1～10')
    // Per-model rules that callers get wrong most often.
    expect(source).toContain('只支持 auto，传其它值返回 400')
    expect(source).toContain('不接受 16:9 这类比例')
  })
})
