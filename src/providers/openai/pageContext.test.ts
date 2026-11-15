import { describe, expect, it } from 'vitest'
import { normalizeOpenaiResponsesBody } from './relay'

const page = { type: 'function_call_output', namespace: 'agent', name: 'codex_apps_open_page', output: '{"page_id":null}' }
const normalize = (input: unknown[]) => normalizeOpenaiResponsesBody({ model: 'gpt-6.1-sol', input }).input
const message = (name: string, text: string) => ({ type: 'message', role: 'user',
  content: [{ type: 'input_text', text: `<external_${name}>\n${text}\n</external_${name}>` }] })

describe('Codex Desktop page context', () => {
  it('preserves page snapshots as user text in their original order and leaves real tool history intact', () => {
    const tool = { type: 'function_call', call_id: 'call-1', name: 'shell', arguments: '{}' }
    const result = { type: 'function_call_output', call_id: 'call-1', output: 'Done' }
    const selected = { ...page, name: 'codex_apps_selected_page_part_1_of_1',
      output: 'Companion Page snapshot part 1 of 1:\n{"page_id":"page-1","number":9007199254740993,"text":"原始内容"}' }
    const input = [page, tool, result, selected, { role: 'user', content: 'Explain this page' }]
    const original = structuredClone(input)
    const expected = [message(page.name, page.output), tool, result, message(selected.name, selected.output), input[4]]
    expect(normalize(input)).toEqual(expected)
    expect(normalize(expected)).toEqual(expected)
    expect(input).toEqual(original)
  })

  it('keeps multipart fragments verbatim even when the snapshot splits inside a string', () => {
    const items = ['{"page_id":"page-1","text":"first', 'second"}'].map((fragment, i) => ({ ...page,
      name: `codex_apps_selected_page_part_${i + 1}_of_2`, output: `Companion Page snapshot part ${i + 1} of 2:\r\n${fragment}` }))
    expect(normalize(items)).toEqual(items.map(item => message(item.name, item.output)))
  })

  it('allows repeated keys in different objects and punctuation within snapshot strings', () => {
    const output = JSON.stringify({ page_id: 'page-1', document_view: [{ text: '{"page_id":null}:[]' }, { text: 'second' }] })
    expect(normalize([{ ...page, output }])).toEqual([message(page.name, output)])
  })

  it.each(['', '  '])('accepts an empty injected call_id %j', call_id => {
    expect(normalize([{ ...page, call_id }])).toEqual([message(page.name, page.output)])
  })

  it.each([
    { namespace: 'functions' }, { name: 'codex_apps_other' }, { type: 'custom_tool_call_output' },
    { call_id: 'call-1' }, { call_id: null }, { call_id: 1 }, { output: null },
    { output: '{"page_id":42}' }, { output: '{"page_id":" "}' }, { output: '{}' },
    { output: '{"page_id":null,"page_id":"ambiguous"}' }, { output: 'not JSON' },
    { output: '{"page_id":null,"page_\\u0069d":"ambiguous"}' },
    { output: '{"page_id":null,"document_view":{"text":"first","text":"second"}}' },
    { name: 'codex_apps_selected_page_part_2_of_1', output: 'Companion Page snapshot part 2 of 1:\n{"page_id":null}' },
    { name: 'codex_apps_selected_page_part_1_of_1', output: 'Wrong header\n{"page_id":null}' },
    { name: 'codex_apps_selected_page_part_1_of_1', output: 'Companion Page snapshot part 1 of 1:\n{"page_id":' },
  ])('does not reinterpret real tools or malformed context: %j', override => {
    const item = { ...page, ...override }
    expect(normalize([item])).toEqual([item])
  })
})
