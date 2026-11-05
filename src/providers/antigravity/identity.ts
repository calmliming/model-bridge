/** Rewrite known leading identity metadata; preserve task-bearing role suffixes. */
export function neutralizeSystemIdentity(text: string): string {
  const attribution = /^\s*x-anthropic-billing-header:[^\r\n]*(?:\r?\n|$)/i
  for (let i = 0; i < 10 && attribution.test(text); i++) text = text.replace(attribution, '')
  const opener = /^(\s*)You are (?:ChatGPT|Codex|GPT-[\w.-]+|Claude(?: Code)?|Gemini)(?=$|[\s,.!?])/i.exec(text)
  if (!opener) return text
  let suffix = text.slice(opener[0].length)
  const metadata = /^(?:,?\s+(?:an? |the )?(?:AI(?: coding)? (?:model|assistant)|(?:large )?language model) (?:developed|created|trained) by (?:OpenAI|Anthropic|Google)|,?\s+(?:an? (?:coding )?agent )?based on GPT-[\w.-]+| running in the Codex CLI|,\s+Anthropic's official CLI for Claude)[.!?]?/i.exec(suffix)
  if (metadata) {
    suffix = suffix.slice(metadata[0].length)
    return opener[1] + 'You are an AI assistant.' + suffix
  }
  return opener[1] + 'You are an AI assistant' + (suffix || '.')
}

export function neutralizeSystemInstruction(value: unknown): unknown {
  if (typeof value === 'string') return neutralizeSystemIdentity(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const instruction = value as Record<string, unknown>
  return { ...instruction, ...(Array.isArray(instruction.parts) ? { parts: instruction.parts.map(part => {
    if (!part || typeof part !== 'object' || typeof part.text !== 'string') return part
    return { ...part, text: neutralizeSystemIdentity(part.text) }
  }) } : {}) }
}
