import { describe, expect, it } from 'vitest'
import { buildWechatXml, parseWechatXml, WECHAT_XML_LIMIT } from './wechatXml'

describe('WeChat XML payloads', () => {
  it.each(['', '\n'])('parses flat fields with or without formatting', separator => {
    const xml = `<xml>${separator}<return_code><![CDATA[SUCCESS]]></return_code>${separator}<total_fee>0072</total_fee>${separator}<body>A&amp;B</body>${separator}<empty/>${separator}</xml>`
    expect(parseWechatXml(xml)).toEqual({ return_code: 'SUCCESS', total_fee: '0072', body: 'A&B', empty: '' })
  })

  it('preserves signed text and safely encodes CDATA terminators', () => {
    const body = '订单]]><sign>伪造</sign> & <字符>\n第二行'
    const xml = buildWechatXml({ body, total_fee: '7200' })
    expect(parseWechatXml(xml)).toEqual({ body, total_fee: '7200' })
  })

  it.each([
    '<xml><sign>A</sign><sign>B</sign></xml>',
    '<xml><sign><nested>A</nested></sign></xml>',
    '<xml><sign attr="bad">A</sign></xml>',
    '<xml><sign>A</xml>',
    '<other><sign>A</sign></other>',
    '<xml><sign>A</sign></xml><xml><sign>B</sign></xml>',
    '<!DOCTYPE xml [<!ENTITY secret SYSTEM "file:///etc/passwd">]><xml><sign>&secret;</sign></xml>',
  ])('rejects malformed or ambiguous signed data: %s', xml => {
    expect(() => parseWechatXml(xml)).toThrow(/WeChat Pay XML/)
  })

  it('bounds XML parsing by bytes', () => {
    expect(() => parseWechatXml(`<xml><body>${'汉'.repeat(WECHAT_XML_LIMIT / 3)}</body></xml>`)).toThrow()
  })
})
