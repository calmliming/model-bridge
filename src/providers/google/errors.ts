import { redactUpstreamError } from '../../http/upstreamDiagnostics'

/** Match service eligibility messages, not generic permission or parameter errors. */
export function isGoogleLocationUnsupported(status: number, text: string): boolean {
  if (status !== 400 && status !== 403) return false
  return /\b(?:unsupported_country_region_territory|LOCATION_UNSUPPORTED|UNSUPPORTED_LOCATION|UNSUPPORTED_REGION)\b/i.test(text)
    || /\buser location is not supported\b/i.test(text)
    || /\b(?:country|region|territory|location) is not supported for (?:this|the) (?:service|api|account)\b/i.test(text)
    || /\bnot (?:available|supported) in (?:your|this|the current) (?:country|region|location)\b/i.test(text)
    || /\bcountry, region, or territory not supported\b/i.test(text)
}

export function googleErrorMessage(status: number, text: string): string {
  if (isGoogleLocationUnsupported(status, text)) {
    return 'google_location_unsupported: Google 拒绝了当前地区或账号资格；请核对服务器出口、账号所属地区和服务可用范围。更换网络出口不保证改变账号资格。'
  }
  try {
    const body = JSON.parse(text) as { error?: unknown; error_description?: unknown }
    const error = typeof body.error === 'string' ? body.error
      : body.error && typeof body.error === 'object'
        ? [Reflect.get(body.error, 'status'), Reflect.get(body.error, 'message')].filter(x => typeof x === 'string').join(': ')
        : ''
    return redactUpstreamError([error, typeof body.error_description === 'string' ? body.error_description : ''].filter(Boolean).join(': ') || `Google HTTP ${status}`)
  } catch {
    return `Google HTTP ${status}`
  }
}
