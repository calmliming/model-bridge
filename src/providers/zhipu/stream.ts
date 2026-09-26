import { createChatResponsesStreamTransform } from '../chatResponsesStream'
export type { StreamTransform } from '../chatResponsesStream'

export function createZhipuResponsesStreamTransform() {
  return createChatResponsesStreamTransform('glm-5.3')
}
