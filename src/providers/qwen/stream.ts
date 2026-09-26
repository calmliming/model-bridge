import { createChatResponsesStreamTransform } from '../chatResponsesStream'
export type { StreamTransform } from '../chatResponsesStream'

export function createQwenResponsesStreamTransform() {
  return createChatResponsesStreamTransform('qwen3.8-max')
}
