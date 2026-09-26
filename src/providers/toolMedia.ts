import { ProviderRequestError } from './requestError'
type Row = Record<string, unknown>
const row = (v: unknown): Row | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : null
export interface ImagePart extends Row { type: 'image_url'; image_url: { url: string; detail?: string } }
const imageTypes = new Set(['input_image', 'image_url', 'image'])
const unsupportedMedia = new Set(['input_file', 'file', 'input_audio', 'audio', 'input_video', 'video', 'video_url'])
const textTypes = new Set(['text', 'input_text', 'output_text'])
const unsupported = () => new ProviderRequestError('unsupported_content_type', 'This content cannot be represented by the target protocol; use a supported image URL or image data URL.')

export function imagePart(value: unknown): ImagePart | null {
  const part = row(value)
  if (!part || !imageTypes.has(String(part.type))) return null
  const source = row(part.source)
  const image = row(part.image_url)
  const url = typeof part.image_url === 'string' ? part.image_url : image?.url ?? source?.url ??
    (source?.type === 'base64' && typeof source.media_type === 'string' && typeof source.data === 'string'
      ? `data:${source.media_type};base64,${source.data}` : null)
  if (typeof url !== 'string' || !/^(https?:\/\/\S+|data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+)$/i.test(url)) throw unsupported()
  const detail = image?.detail ?? part.detail
  return { type: 'image_url', image_url: { url, ...(typeof detail === 'string' ? { detail } : {}) } }
}

/** Ordinary business JSON is left intact. Recognized content arrays must not stringify media. */
export function splitToolMedia(value: unknown): { text: string; images: ImagePart[] } {
  if (!Array.isArray(value)) return { text: typeof value === 'string' ? value : JSON.stringify(value ?? ''), images: [] }
  const parts = value.map(row)
  const structured = parts.some(p => p && (imageTypes.has(String(p.type)) || textTypes.has(String(p.type)) || unsupportedMedia.has(String(p.type))))
  if (!structured) return { text: JSON.stringify(value), images: [] }
  const images: ImagePart[] = [], texts: string[] = []
  for (const part of parts) {
    if (!part) throw unsupported()
    const image = imagePart(part)
    if (image) images.push(image)
    else if (textTypes.has(String(part.type)) && typeof part.text === 'string') texts.push(part.text)
    else throw unsupported()
  }
  return { text: texts.join('\n') || (images.length ? '[image]' : ''), images }
}

export function chatContent(value: unknown): string | Array<Row | ImagePart> {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  const parts: Array<Row | ImagePart> = []
  for (const raw of value) {
    if (typeof raw === 'string') { parts.push({ type: 'text', text: raw }); continue }
    const part = row(raw)
    if (!part) continue
    const image = imagePart(part)
    if (image) parts.push(image)
    else if (textTypes.has(String(part.type)) && typeof part.text === 'string') parts.push({ type: 'text', text: part.text })
    else if (unsupportedMedia.has(String(part.type))) throw unsupported()
  }
  return parts.some(p => p.type === 'image_url') ? parts : parts.map(p => 'text' in p ? p.text : '').join('')
}

/** Flush media after all consecutive tool replies, preserving parallel call adjacency. */
export function liftResponsesToolMedia(input: unknown[]): unknown[] {
  const out: unknown[] = [], pending: ImagePart[] = []
  const flush = () => { if (pending.length) out.push({ role: 'user', content: pending.splice(0) }) }
  for (const raw of input) {
    const item = row(raw)
    if (item?.type === 'function_call_output') {
      const { text, images } = splitToolMedia(item.output)
      out.push({ ...item, output: text })
      pending.push(...images)
    } else { flush(); out.push(raw) }
  }
  flush()
  return out
}

export function assertChatImageSupport(provider: string, model: string, messages: Array<{ content?: unknown }>): void {
  // Verified text-only model. Unknown models retain upstream capability validation.
  if (provider === 'zhipu' && /^glm-5\.2(?:$|-)/i.test(model) && messages.some(m => Array.isArray(m.content) && m.content.some(p => row(p)?.type === 'image_url'))) {
    throw new ProviderRequestError('unsupported_image_input', `${model} does not support image input.`)
  }
}

export function anthropicContent(value: unknown): Row[] {
  const converted = chatContent(value)
  if (typeof converted === 'string') return converted ? [{ type: 'text', text: converted }] : []
  return converted.map(part => {
    if (part.type !== 'image_url') return part as Row
    const url = (part as ImagePart).image_url.url
    const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(url)
    return { type: 'image', source: match ? { type: 'base64', media_type: match[1], data: match[2] } : { type: 'url', url } }
  })
}
