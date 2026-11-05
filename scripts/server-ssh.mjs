#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHmac, timingSafeEqual } from 'node:crypto'
import ssh2 from 'ssh2'

const root = fileURLToPath(new URL('../', import.meta.url))
const configFile = path.join(root, '.deployment/ssh.local.json')
const [action = 'check', scriptFile, ...extra] = process.argv.slice(2)
const actions = ['check', 'run', 'sudo-run']

if (action === 'help' || action === '--help') {
  console.log('用法：node scripts/server-ssh.mjs check | run <script.sh> | sudo-run <script.sh>')
  process.exit(0)
}
if (!actions.includes(action) || extra.length || (action === 'check' ? !!scriptFile : !scriptFile)) {
  console.error('用法：node scripts/server-ssh.mjs check | run <script.sh> | sudo-run <script.sh>')
  process.exit(1)
}

let connection
let secrets = []
const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), String(value))

try {
  if (!fs.existsSync(configFile)) throw new Error('缺少 .deployment/ssh.local.json，请按项目部署文档配置本机凭据。')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''))
  const { host, username, port = 22 } = config
  if (typeof host !== 'string' || !/^[A-Za-z0-9.-]+$/.test(host) ||
      typeof username !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(username) ||
      !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('本机 SSH 地址、用户名或端口配置无效。')
  }
  if (config.passwordProtected) secrets.push(config.passwordProtected)
  let password = process.env.MODEL_BRIDGE_SSH_PASSWORD
  if (!password) {
    if (process.platform !== 'win32' || config.credentialProtection !== 'windows-dpapi-current-user' ||
        typeof config.passwordProtected !== 'string' || !config.passwordProtected) {
      throw new Error('需要当前 Windows 用户的加密凭据，或进程环境变量 MODEL_BRIDGE_SSH_PASSWORD。')
    }
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
    try {
      password = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `
        [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
        [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1" -ErrorAction Stop
        $protected = [Console]::In.ReadToEnd()
        $secure = ConvertTo-SecureString -String $protected -ErrorAction Stop
        $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { [Console]::Out.Write([System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }
        finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
      `], { input: config.passwordProtected, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch {
      throw new Error('本机凭据解密失败，请使用保存凭据时的 Windows 用户或重新配置口令。')
    }
  }
  if (!password) throw new Error('SSH 口令为空。')
  secrets.push(password)

  const knownName = port === 22 ? host : `[${host}]:${port}`
  const knownHosts = fs.readFileSync(path.join(os.homedir(), '.ssh/known_hosts'), 'utf8')
  const matchesHost = names => names.split(',').some(name => {
    if (name === knownName) return true
    if (!name.startsWith('|1|')) return false
    const [, , salt, hash] = name.split('|')
    return !!salt && !!hash && createHmac('sha1', Buffer.from(salt, 'base64')).update(knownName).digest('base64') === hash
  })
  const pins = knownHosts.split(/\r?\n/).flatMap(line => {
    const [names, type, encoded] = line.trim().split(/\s+/)
    return names && !names.startsWith('#') && !names.startsWith('@') && encoded && matchesHost(names)
      ? [{ type, key: Buffer.from(encoded, 'base64') }] : []
  })
  if (!pins.length) throw new Error('known_hosts 中没有该服务器的受信任主机密钥，请先核验主机指纹。')
  const algorithms = [...new Set(pins.flatMap(pin => pin.type === 'ssh-rsa'
    ? ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'] : [pin.type]))]
  const input = action === 'check' ? `set -eu
hostname
id
sudo -n docker inspect model-bridge --format '{{.Name}} {{.State.Status}}'
sudo -n docker exec model-bridge node --input-type=module -e 'import { readFileSync } from "node:fs"; console.log(JSON.stringify({version: JSON.parse(readFileSync("package.json", "utf8")).version, commit: process.env.GIT_COMMIT || null}))'
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3001/health
printf '\\n'
` : fs.readFileSync(path.resolve(scriptFile), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')

  connection = new ssh2.Client()
  await new Promise((resolve, reject) => {
    connection.once('ready', resolve).once('error', reject).connect({
      host, port, username, password, readyTimeout: 25000,
      keepaliveInterval: 10000, keepaliveCountMax: 3,
      algorithms: { serverHostKey: algorithms },
      hostVerifier: key => pins.some(pin => pin.key.length === key.length && timingSafeEqual(pin.key, key)),
    })
  })
  const result = await new Promise((resolve, reject) => {
    connection.exec(action === 'sudo-run' ? 'sudo -n bash -s' : 'bash -s', (error, stream) => {
      if (error) return reject(error)
      const chunks = []
      stream.on('data', chunk => chunks.push(chunk))
      stream.stderr.on('data', chunk => chunks.push(chunk))
      stream.on('error', reject)
      stream.on('close', code => resolve({ code, output: Buffer.concat(chunks).toString('utf8') }))
      stream.end(input)
    })
  })
  process.stdout.write(redact(result.output))
  if (result.code !== 0) process.exitCode = result.code || 1
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error))
  process.exitCode = 1
} finally {
  connection?.end()
}
