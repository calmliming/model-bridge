import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

/**
 * The sidebars are static declarations inside `<script setup>`, so a typo in a
 * group id, a duplicated route or an icon name that no longer exists in
 * `menuIconPaths` only shows up when someone opens that page. These checks keep
 * the two sidebars (admin and user) aligned with the router and with their own
 * icon table without pulling Vue into the test.
 *
 * Grouping contract: the first group is always the dashboard/overview entry,
 * every item belongs to exactly one group, and group order is the display order.
 */
interface MenuItem {
  to: string
  key: string
  label: string
  icon: string
}

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

/**
 * Read the flat `key: 'value'` tables declared in the layouts (icon keys, and
 * the icon `d` values themselves). Keys may be bare identifiers or quoted, so
 * both forms are collected while skipping comments.
 */
function scanLiteral(source: string, start: number): Record<string, string> {
  const result: Record<string, string> = {}
  let depth = 0
  let index = start
  while (index < source.length) {
    const char = source[index]
    if (char === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index)
      if (index === -1) break
      continue
    }
    if (char === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index) + 2
      continue
    }
    if (char === '{' || char === '[') {
      depth += 1
      index += 1
      continue
    }
    if (char === '}' || char === ']') {
      depth -= 1
      if (depth === 0) break
      index += 1
      continue
    }
    if (depth === 1) {
      const key = /^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/.exec(source.slice(index))
      if (key) {
        const name = key[1] ?? key[2] ?? key[3]
        if (name !== undefined) result[name] = '1'
        index += key[0].length
        continue
      }
    }
    index += 1
  }
  return result
}

/**
 * Read `menuGroups` straight out of the SFC `<script setup>` as raw `{...}`
 * blocks. Groups nest items two levels deep, so they are extracted by balanced
 * braces instead of regex matching, which would silently accept a broken
 * declaration.
 */
function readMenuGroups(relativePath: string): string[] {
  const source = readSource(relativePath)
  const script = parseSfc(source, { filename: relativePath }).descriptor.scriptSetup?.content
  if (!script) throw new Error(`${relativePath} has no <script setup>`)

  const declaration = script.indexOf('const menuGroups')
  if (declaration === -1) throw new Error(`${relativePath} has no menuGroups declaration`)
  const assignment = script.indexOf('=', declaration)
  const start = script.indexOf('[', assignment)
  if (start === -1) throw new Error(`${relativePath} menuGroups is not an array`)
  return readObjects(readBalanced(script, start))
}

/** One menu item, with the decoded fields and the group it belongs to. */
function menuItems(relativePath: string): Array<{ group: string; item: MenuItem }> {
  const groups = readMenuGroups(relativePath)
  return groups.flatMap((group) => {
    const label = unquote(entryValue(group, 'label') ?? '') ?? ''
    return readObjects(entryBlock(group, 'items') ?? '').map(block => ({
      group: label,
      item: readEntry(block) as unknown as MenuItem,
    }))
  })
}

/** Decode one `{...}` block into `{ key: value }`, unquoting string literals. */
function readEntry(block: string): Record<string, string> {
  const entry: Record<string, string> = {}
  for (const [name, value] of splitTopLevel(block.slice(1, -1))) {
    entry[name] = unquote(value) ?? value
  }
  return entry
}

/** Icon keys declared in the layout's `menuIconPaths` table. */
function readIconKeys(relativePath: string): string[] {
  const source = readSource(relativePath)
  const table = source.indexOf('const menuIconPaths')
  if (table === -1) throw new Error(`${relativePath} has no menuIconPaths table`)
  return Object.keys(scanLiteral(source, source.indexOf('{', table)))
}

/** Read the balanced `[...]` / `{...}` block that starts at `start`. */
function readBalanced(source: string, start: number): string {
  let depth = 0
  let quote: string | null = null
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index)
      if (index === -1) break
      continue
    }
    if (char === '[' || char === '{') depth += 1
    if (char === ']' || char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error('unbalanced block in the router file')
}

/** Split a balanced `{...}` block into its top-level `key: value` pairs. */
function splitTopLevel(body: string): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  let depth = 0
  let quote: string | null = null
  const parts: string[] = []
  let current = ''
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (quote) {
      current += char
      if (char === '\\') {
        current += body[index + 1] ?? ''
        index += 1
      } else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === '/' && body[index + 1] === '/') {
      index = body.indexOf('\n', index)
      if (index === -1) break
      current += '\n'
      continue
    }
    if (char === '{' || char === '[') depth += 1
    if (char === '}' || char === ']') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current)

  for (const part of parts) {
    const split = part.indexOf(':')
    if (split === -1) continue
    const key = part.slice(0, split).trim().replace(/^['"]|['"]$/g, '')
    entries.push([key, part.slice(split + 1).trim()])
  }
  return entries
}

/** Unquote a single/double quoted string literal, leaving other values as-is. */
function unquote(value: string): string | undefined {
  const match = /^'([^']*)'$/.exec(value.trim()) ?? /^"([^"]*)"$/.exec(value.trim())
  return match?.[1]
}

/** Split `{a: 1}, {b: 2}` into its two balanced `{...}` blocks. */
function readObjects(block: string): string[] {
  const objects: string[] = []
  let depth = 0
  let start = -1
  let quote: string | null = null
  for (let index = 0; index < block.length; index += 1) {
    const char = block[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0 && start !== -1) {
        // 只截取到闭合大括号本身，后面的逗号不能带进来。
        objects.push(block.slice(start, index + 1))
        start = -1
      }
    }
  }
  return objects
}

/** Read one top-level property of a `{...}` block. */
function entryValue(block: string, key: string): string | undefined {
  const entry = splitTopLevel(block.slice(1, -1)).find(([name]) => name === key)
  return entry?.[1]
}

/** Read one nested `{...}` / `[...]` property of a `{...}` block. */
function entryBlock(block: string, key: string): string | undefined {
  const value = entryValue(block, key)
  const start = value?.search(/[[{]/) ?? -1
  if (value === undefined || start === -1) return undefined
  return readBalanced(value, start)
}

/**
 * Resolved `path -> route names` map, walked from the router's own `routes`
 * array so nested relative children keep their parent prefix. A path can carry
 * several names (the model plaza is registered for both roles), so all names of
 * a path are collected.
 */
function readRoutes(): Map<string, string[]> {
  const source = readSource('./src/router/index.ts')
  const key = source.indexOf('routes:')
  if (key === -1) throw new Error('router has no routes array')
  const routes = new Map<string, string[]>()

  /** Join a parent and child route path, dropping redundant slashes. */
  const joinPath = (parent: string, child: string): string => {
    if (child.startsWith('/')) return child
    const base = parent.endsWith('/') ? parent.slice(0, -1) : parent
    return `${base}/${child}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1') || '/'
  }

  const walk = (path: string, name: string | undefined, children: string) => {
    if (name) routes.set(path, [...(routes.get(path) ?? []), name])
    for (const child of readObjects(children)) {
      const childPath = unquote(entryValue(child, 'path') ?? '') ?? ''
      walk(joinPath(path, childPath), unquote(entryValue(child, 'name') ?? ''), entryBlock(child, 'children') ?? '')
    }
  }

  const arrayStart = source.indexOf('[', key)
  for (const route of readObjects(readBalanced(source, arrayStart))) {
    const path = unquote(entryValue(route, 'path') ?? '') ?? '/'
    walk(path || '/', unquote(entryValue(route, 'name') ?? ''), entryBlock(route, 'children') ?? '')
  }
  return routes
}

const LAYOUTS = [
  { name: '管理端', path: './src/layouts/AppLayout.vue', label: 'admin-sidebar' },
  { name: '用户端', path: './src/layouts/UserLayout.vue', label: 'user-sidebar' },
] as const

describe('sidebar menu grouping', () => {
  it('renders every item through groups instead of one flat list', () => {
    for (const layout of LAYOUTS) {
      const source = readSource(layout.path)
      expect(source, `${layout.name}仍有扁平 menu 声明`).not.toMatch(/const menu\s*:/)
      const menuSections = source.match(/v-for="item in group\.items"/g) ?? []
      expect(menuSections.length, `${layout.name}未按分组渲染菜单项`).toBe(1)
      expect(source, `${layout.name}分组缺少标题`).toContain('v-for="group in menuGroups"')
      expect(source, `${layout.name}分组标题未设置无障碍标注`).toContain('role="group"')
    }
  })

  it('keeps every item in exactly one group with its own route and icon', () => {
    const routes = readRoutes()
    const expectedTotals: Record<string, number> = { '管理端': 16, '用户端': 6 }
    const expectedKeys: Record<string, string> = {
      '管理端': 'overview,models,model-catalog,channel-health,accounts,account-groups,keys,users,payments,redeem-codes,subscription-plans,logs,stats,docs,api-docs,settings',
      '用户端': 'user-overview,user-models,user-keys,user-usage,user-logs,api-docs',
    }

    for (const layout of LAYOUTS) {
      const groups = readMenuGroups(layout.path)
      const icons = readIconKeys(layout.path)
      const entries = menuItems(layout.path)
      const items = entries.map(entry => entry.item)

      expect(groups.length, `${layout.name}分组数量异常`).toBeGreaterThan(1)
      expect(items.length, `${layout.name}菜单项总数变化`).toBe(expectedTotals[layout.name])
      expect(items.map(entry => entry.key).join(','), `${layout.name}菜单项顺序或名称变化`).toBe(expectedKeys[layout.name])

      const groupIds = groups.map(group => entryValue(group, 'id'))
      expect(groupIds.every(Boolean), `${layout.name}分组缺少 id`).toBe(true)
      expect(new Set(groupIds).size, `${layout.name}分组 id 重复`).toBe(groupIds.length)
      for (const entry of entries) {
        expect(entry.group, `${layout.name}菜单项 ${entry.item.label} 缺少分组标题`).toBeTruthy()
      }
      for (const group of groups) {
        expect(readObjects(entryBlock(group, 'items') ?? '').length, `${layout.name}分组 ${entryValue(group, 'label')} 是空的`).toBeGreaterThan(0)
      }

      const keys = items.map(entry => entry.key)
      expect(new Set(keys).size, `${layout.name}菜单 key 重复`).toBe(keys.length)
      const targets = items.map(entry => entry.to)
      expect(new Set(targets).size, `${layout.name}菜单指向重复`).toBe(targets.length)

      for (const item of items) {
        expect(item.label, `${layout.name}菜单 ${item.key} 缺少标题`).toBeTruthy()
        // 菜单 `to` 必须落在路由里，且该路径注册的路由名之一就是菜单 key
        // （高亮态按 route.name 匹配，key 写错该项永远不会高亮）。
        expect(routes.get(item.to) ?? [], `${layout.name}菜单 ${item.label} 的 key 与路由名 ${item.to} 不一致`).toContain(item.key)
        expect(icons, `${layout.name}菜单 ${item.label} 使用了未定义的图标 ${item.icon}`).toContain(item.icon)
      }
    }
  })

  it('starts with the dashboard and keeps management and account areas apart', () => {
    const admin = menuItems(LAYOUTS[0].path)
    expect(admin[0].item.key).toBe('overview')
    // 上游账号调度与终端用户/计费不能混在同一组里。
    const groupOf = (key: string) => admin.find(entry => entry.item.key === key)?.group
    expect(groupOf('overview')).toBe('概览')
    expect(groupOf('models')).toBe(groupOf('overview'))
    expect(groupOf('accounts')).toBe('账号与调度')
    expect(groupOf('account-groups')).toBe(groupOf('accounts'))
    expect(groupOf('keys')).toBe('访问与用户')
    expect(groupOf('users')).toBe(groupOf('keys'))
    expect(groupOf('payments')).toBe('计费与套餐')
    expect(groupOf('redeem-codes')).toBe(groupOf('payments'))
    expect(groupOf('subscription-plans')).toBe(groupOf('payments'))
    expect(groupOf('logs')).toBe('数据分析')
    expect(groupOf('stats')).toBe(groupOf('logs'))
    expect(groupOf('docs')).toBe('文档与支持')
    expect(groupOf('api-docs')).toBe(groupOf('docs'))
    expect(admin.at(-1)?.group).toBe('系统')
    expect(admin.at(-1)?.item.key).toBe('settings')

    const user = menuItems(LAYOUTS[1].path)
    expect(user[0].item.key).toBe('user-overview')
    expect(user.some(entry => entry.item.key === 'api-docs' && entry.group === '帮助与文档')).toBe(true)
  })

  it('keeps the active-item marker and collapse behaviour on every item', () => {
    for (const layout of LAYOUTS) {
      const source = readSource(layout.path)
      expect(source).toContain('activeKey === item.key')
      // 收起态隐藏分组标题，菜单项居中显示。
      expect(source).toContain("sidebarCollapsed && 'lg:hidden'")
      expect(source).toContain('lg:justify-center')
    }
  })
})
