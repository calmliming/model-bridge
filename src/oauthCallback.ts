import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { db } from './db/index'
import { oauthSessions } from './db/schema'
import { getProvider } from './providers/registry'
import { createAccount } from './accounts/manager'

const PORT = 1455
const HOST = '127.0.0.1'

function resultPage(message: string, ok: boolean): string {
  const accent = ok ? '#5b8cff' : '#ef4444'
  const title = ok ? '授权完成' : '授权失败'
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>model-bridge</title>
<style>
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;
background:#0f172a;color:#e6edf6}
.card{background:#1e293b;border:1px solid rgba(255,255,255,.08);border-radius:14px;
padding:32px 40px;text-align:center;max-width:420px}
h1{margin:0 0 10px;font-size:22px;color:${accent}}
p{margin:0;opacity:.72;font-size:14px;line-height:1.7}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`
}

/**
 * OpenAI's public OAuth client only accepts http://localhost:1455/auth/callback
 * as a redirect URI, so a small dedicated server has to listen there to
 * complete the flow. Other providers using a redirect-style flow can share it.
 */
export function startOauthCallbackServer(): void {
  const server = createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400).end()
      return
    }
    const url = new URL(req.url, `http://${HOST}:${PORT}`)
    // OpenAI registered /auth/callback; Google's installed-app flow uses
    // /oauth2callback. Accept both — both deliver `code` and `state`.
    if (url.pathname !== '/auth/callback' && url.pathname !== '/oauth2callback') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
      return
    }
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')
    const writeResult = (status: number, ok: boolean, message: string) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
      res.end(resultPage(message, ok))
    }
    if (error) return writeResult(400, false, `OAuth 返回错误：${error}`)
    if (!code || !state) return writeResult(400, false, '缺少 code 或 state 参数')

    const [session] = await db
      .select()
      .from(oauthSessions)
      .where(eq(oauthSessions.state, state))
    if (!session) {
      return writeResult(400, false, 'OAuth 会话已过期或不存在，请重新发起授权')
    }
    const provider = getProvider(session.provider)
    if (!provider) {
      return writeResult(400, false, `未知服务商：${session.provider}`)
    }
    try {
      const tokens = await provider.exchangeCode(code, session.codeVerifier, state)
      let metadata: Record<string, unknown> | null = null
      if (provider.fetchAccountMetadata) {
        metadata = await provider.fetchAccountMetadata(tokens.accessToken)
      }
      await createAccount({
        provider: session.provider,
        name: session.accountName ?? `${session.provider} account`,
        tokens,
        metadata,
      })
      await db.delete(oauthSessions).where(eq(oauthSessions.state, state))
      writeResult(200, true, '您可以关闭此页面，回到 model-bridge 后台。')
    } catch (err) {
      writeResult(400, false, `授权失败：${(err as Error).message}`)
    }
  })
  server.on('error', (err) => {
    // EADDRINUSE typically means a leftover orphan; log but don't crash.
    console.error(`[oauth-callback] failed to bind ${HOST}:${PORT}: ${(err as Error).message}`)
  })
  server.listen(PORT, HOST, () => {
    console.log(`[oauth-callback] listening on http://${HOST}:${PORT}/auth/callback`)
  })
}
