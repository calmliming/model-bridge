import { loadAlipayPaymentConfig } from '../src/payments/config'
import { AlipayProvider } from '../src/payments/providers/alipay'
import { config as runtimeConfig } from '../src/config'

if (runtimeConfig.ALIPAY_ENV !== 'sandbox') {
  throw new Error('pay:smoke only supports ALIPAY_ENV=sandbox; use pay:check for production')
}

const config = loadAlipayPaymentConfig()
if (!config) {
  throw new Error('Alipay config is not ready; check ALIPAY_ENV and .alipay-sandbox.json')
}

const provider = new AlipayProvider(config)
const orderId = `sbx${Date.now()}`

const probe = await provider.queryOrder('probe_does_not_exist').catch((err: Error) => err)
console.log('query probe result:', probe instanceof Error ? probe.message : (probe.rawData.code as string))

const created = await provider.createPayment({
  orderId,
  amount: 0.01,
  amountMicros: 10_000,
  subject: 'Model Bridge 沙箱充值测试',
  userId: 'smoke',
})

console.log('precreate ok')
console.log('out_trade_no:', created.providerOrderId)
console.log('qr_code:', created.qrCode)

const queried = await provider.queryOrder(orderId).catch((err: Error) => err)
if (queried instanceof Error) {
  console.log('query after precreate:', queried.message)
} else {
  console.log('query trade_status:', (queried.rawData.trade_status as string) ?? '(none)')
}
console.log('smoke passed: signing + 当面付 precreate reachable; scan the qr_code with the sandbox wallet to test the paid path')
