import { expect, it } from 'vitest'
import { responsesToChatCompletions } from './converter'
it.each(['low', 'high', 'max'])('maps GLM 5.3 effort %s', effort => {
  expect(responsesToChatCompletions({ model: 'glm-5.3', reasoning: { effort }, input: 'Hi' }).reasoning_effort).toBe(effort)
})
it('allows explicit legacy effort but rejects conflicts and unsupported levels', () => {
  expect(responsesToChatCompletions({ model: 'glm-5.3', reasoning_effort: 'high' }).reasoning_effort).toBe('high')
  expect(() => responsesToChatCompletions({ model: 'glm-5.3', reasoning: { effort: 'high' }, reasoning_effort: 'low' })).toThrow(/must agree/)
  for (const effort of ['medium', 'xhigh', 'ultra', null, 1]) expect(() => responsesToChatCompletions({ model: 'glm-5.3', reasoning: { effort } })).toThrow()
  expect(() => responsesToChatCompletions({ model: 'glm-5.2', reasoning: { effort: 'low' } })).toThrow()
  expect(responsesToChatCompletions({ model: 'glm-5.2', reasoning: { effort: 'max' } }).reasoning_effort).toBe('max')
  expect(responsesToChatCompletions({ input: 'Hi' }).reasoning_effort).toBeUndefined()
})
