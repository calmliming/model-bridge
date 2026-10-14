import { XMLParser, XMLValidator } from 'fast-xml-parser'

export const WECHAT_XML_LIMIT = 256 * 1024
const fieldName = /^[A-Za-z_][A-Za-z0-9_]*$/
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
})

/** WeChat v2 payloads are one flat <xml> element containing string fields. */
export function parseWechatXml(xml: string): Record<string, string> {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > WECHAT_XML_LIMIT
    || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new Error('Invalid WeChat Pay XML')
  }
  const document = parser.parse(xml) as Record<string, unknown>
  const root = document.xml
  if (Object.keys(document).length !== 1 || !root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Invalid WeChat Pay XML root')
  }
  const result: Record<string, string> = Object.create(null)
  for (const [name, value] of Object.entries(root)) {
    if (name === '#text' && typeof value === 'string' && !value.trim()) continue
    if (!fieldName.test(name) || typeof value !== 'string') {
      throw new Error('Invalid or duplicate WeChat Pay XML field')
    }
    result[name] = value
  }
  return result
}

/** Split CDATA terminators so merchant text cannot inject XML fields. */
export function buildWechatXml(data: Record<string, unknown>): string {
  return `<xml>${Object.entries(data).map(([name, value]) => {
    if (!fieldName.test(name)) throw new Error('Invalid WeChat Pay XML field name')
    return `<${name}><![CDATA[${String(value).replaceAll(']]>', ']]]]><![CDATA[>')}]]></${name}>`
  }).join('')}</xml>`
}
