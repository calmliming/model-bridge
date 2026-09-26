import { cancelUpstreamResponse } from '../../http/cancellation'

/** A semantic Responses terminal, including protocol errors, ends generation. */
export function isResponsesTerminalBlock(block: string): boolean {
  const data = block.split('\n').filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart()).join('\n')
  try {
    return ['response.completed', 'response.failed', 'response.incomplete', 'error'].includes(JSON.parse(data)?.type)
  } catch {
    return false
  }
}

/** Buffer through the terminal event; some upstreams keep HTTP open indefinitely. */
export async function readResponsesSse(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let transcript = ''
  let terminal = false
  try {
    while (!terminal) {
      const { done, value } = await reader.read()
      if (done) {
        transcript += buffer + decoder.decode()
        break
      }
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep)
        transcript += `${block}\n\n`
        buffer = buffer.slice(sep + 2)
        if (isResponsesTerminalBlock(block)) {
          terminal = true
          break
        }
      }
    }
  } finally {
    reader.releaseLock()
    if (terminal) await cancelUpstreamResponse(response)
  }
  return transcript
}
