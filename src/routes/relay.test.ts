import { describe, expect, it } from 'vitest'
import { newResponsesStreamState, noteResponsesTerminal, responsesStreamStatus } from './relay'

describe('responsesStreamStatus', () => {
  it('records response.completed as success', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal({ type: 'response.completed', response: {} }, state)
    expect(responsesStreamStatus(true, true, state)).toBe('success')
  })

  it('records response.failed as error (e.g. cyber_policy hard block)', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal(
      { type: 'response.failed', response: { error: { code: 'cyber_policy', message: 'blocked' } } },
      state,
    )
    expect(responsesStreamStatus(true, true, state)).toBe('error')
  })

  it('records response.incomplete as error', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal({ type: 'response.incomplete', response: {} }, state)
    expect(responsesStreamStatus(true, true, state)).toBe('error')
  })

  it('treats a stream with no terminal event as error', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal({ type: 'response.output_text.delta', delta: 'hi' }, state)
    expect(responsesStreamStatus(true, true, state)).toBe('error')
  })

  it('still records error when a failure precedes any completion', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal({ type: 'response.failed', response: {} }, state)
    noteResponsesTerminal({ type: 'response.completed', response: {} }, state)
    expect(responsesStreamStatus(true, true, state)).toBe('error')
  })

  it('keys off upstream.ok for non-Responses providers regardless of terminals', () => {
    const state = newResponsesStreamState()
    expect(responsesStreamStatus(true, false, state)).toBe('success')
    expect(responsesStreamStatus(false, false, state)).toBe('error')
  })

  it('is always an error when the upstream response was not ok', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal({ type: 'response.completed', response: {} }, state)
    expect(responsesStreamStatus(false, true, state)).toBe('error')
  })
})
