import { createChatResponsesStreamTransform } from '../chatResponsesStream'
export type { StreamTransform } from '../chatResponsesStream'

export function createKimiResponsesStreamTransform() {
  return createChatResponsesStreamTransform('kimi-k3')
}
