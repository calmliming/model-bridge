import { createChatResponsesStreamTransform } from '../chatResponsesStream'
export type { StreamTransform } from '../chatResponsesStream'

export function createXiaomiResponsesStreamTransform() {
  return createChatResponsesStreamTransform('mimo-v2.5-pro')
}
