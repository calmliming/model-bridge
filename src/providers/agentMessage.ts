/**
 * Codex agent_message carries an envelope and task/reply text. Custom chat
 * providers receive the body as plaintext in encrypted_content parts; this
 * does not decode native encrypted reasoning or other Responses item types.
 */
export function agentMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue
    const row = part as Record<string, unknown>
    if ((row.type === 'input_text' || row.type === 'text') && typeof row.text === 'string') {
      parts.push(row.text)
    } else if (row.type === 'encrypted_content' && typeof row.encrypted_content === 'string') {
      parts.push(row.encrypted_content)
    }
  }
  return parts.join('')
}
