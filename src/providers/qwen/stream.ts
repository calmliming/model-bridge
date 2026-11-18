import { createChatResponsesStreamTransform } from '../chatResponsesStream'
import { DEFAULT_QWEN_MODEL } from './converter'
export type { StreamTransform } from '../chatResponsesStream'

export function createQwenResponsesStreamTransform() {
  return createChatResponsesStreamTransform(DEFAULT_QWEN_MODEL)
}
