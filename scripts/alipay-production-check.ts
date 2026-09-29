import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { parse } from 'dotenv'
import { parseAlipayProductionConfig } from '../src/payments/alipay-production'
import { createAlipaySdk } from '../src/payments/providers/alipay-client'

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    'env-file': { type: 'string' },
    probe: { type: 'boolean', default: false },
  } })
  const envFile = values['env-file'] ?? (process.env.NODE_ENV !== 'production' && existsSync('.env.local') ? '.env.local' : '.env')
  if (values['env-file'] && !existsSync(envFile)) throw new Error('指定的环境文件不存在')
  // Explicit files are checked in isolation. Default selection follows the server's env precedence.
  const env = { ...(values['env-file'] ? {} : process.env), ...(existsSync(envFile) ? parse(readFileSync(envFile)) : {}) }
  console.log(`检查环境文件：${envFile}（只读）`)
  if (env.ALIPAY_ENV && env.ALIPAY_ENV !== 'production') throw new Error('当前 ALIPAY_ENV 不是 production，请指定正式环境文件')
  const config = parseAlipayProductionConfig(env)
  if (!config) throw new Error('尚未配置正式支付宝 APPID 和密钥')
  console.log(`本地配置检查通过：APPID ****${config.appId.slice(-4)}，产品 ${config.paymentMode}，密钥 ${config.keyType}`)
  console.log(`异步通知：${config.notifyUrl}`)
  if (config.returnUrl) console.log(`支付回跳：${config.returnUrl}`)
  if (values.probe) {
    const sdk = createAlipaySdk(config)
    let result
    try {
      result = await sdk.exec('alipay.trade.query', {
        bizContent: { out_trade_no: `mb_probe_${randomUUID().replaceAll('-', '')}` },
      }, { validateSign: true })
    } catch {
      throw new Error('网关探测或响应验签失败，请检查网络、应用私钥及支付宝公钥')
    }
    if (result.code !== '40004' || result.sub_code !== 'ACQ.TRADE_NOT_EXIST') {
      throw new Error(`网关探测未得到预期结果：${result.code} / ${result.sub_code ?? '(none)'}`)
    }
    console.log('正式网关查询及响应验签通过；仅查询随机订单号，没有创建订单或扣款。')
  }
  console.log('此检查不证明支付产品已签约或回调公网可达；仍需用户充值页完成真实付款与自动到账联调。')
}

main().catch((error: Error) => {
  console.error(`支付宝检查失败：${error.message}`)
  process.exitCode = 1
})
