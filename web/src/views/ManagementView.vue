<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, errMsg } from '../api/client'

const error = ref(''), notice = ref(''), busy = ref(false)
const keys = ref<any[]>([]), audit = ref<any[]>([]), accounts = ref<any[]>([]), groups = ref<any[]>([])
const permissions = ref<string[]>([]), selectedPermissions = ref(['accounts.read'])
const name = ref(''), accountScope = ref(''), groupScope = ref(''), ips = ref(''), days = ref(30), secret = ref('')
const savedEmails = ref('')
const emails = ref(''), matches = ref<any[]>([]), auditPage = ref(1)
const accountIds = ref<string[]>([]), tiers = ref(['1K', '2K', '4K'])
const groupId = ref(''), billingMode = ref('both')
const labels: Record<string, string> = { 'accounts.read': '查看账号', 'accounts.status.write': '启停账号', 'accounts.quota.read': '查询额度', 'accounts.quota.reset': '消耗重置次数', 'accounts.import': '导入账号凭据', 'groups.read': '查看分组', 'users.read': '查看用户', 'usage.read': '查看用量', 'audit.read': '查看审计' }
const split = (value: string) => [...new Set(value.split(/[\s,，;；]+/).map(x => x.trim()).filter(Boolean))]
async function run(action: () => Promise<void>) { busy.value = true; error.value = ''; notice.value = ''; try { await action() } catch (e) { error.value = errMsg(e) } finally { busy.value = false } }
async function load() {
  const [k, b, a, g] = await Promise.all([api.get('/admin/management-keys'), api.get('/admin/registration-email-blacklist'), api.get('/admin/accounts'), api.get('/admin/account-groups')])
  keys.value = k.data.keys; permissions.value = k.data.permissions; if (emails.value === savedEmails.value) { savedEmails.value = b.data.emails.join('\n'); emails.value = savedEmails.value }
  accounts.value = a.data.accounts.filter((row: any) => row.provider === 'openai'); groups.value = g.data.groups
  await loadAudit()
}
async function loadAudit() { audit.value = (await api.get('/admin/management-audit', { params: { page: auditPage.value, pageSize: 25 } })).data.entries }
async function createKey() {
  await run(async () => {
    const { data } = await api.post('/admin/management-keys', { name: name.value, policy: { permissions: selectedPermissions.value, accountIds: accountScope.value.trim() ? split(accountScope.value) : null, groupIds: groupScope.value.trim() ? split(groupScope.value) : null }, allowedIps: split(ips.value), expiresAt: Date.now() + days.value * 86400000 })
    secret.value = data.key; name.value = ''; await load(); notice.value = '密钥已创建，请立即保存。'
  })
}
async function rotate(id: string) { await run(async () => { secret.value = (await api.post(`/admin/management-keys/${id}/rotate`)).data.key; await load(); notice.value = '旧密钥已失效，请保存新密钥。' }) }
async function revoke(id: string) { if (window.confirm('撤销后，该密钥立即失效。继续撤销？')) await run(async () => { await api.delete(`/admin/management-keys/${id}`); await load() }) }
async function saveBlacklist() { await run(async () => { const result = await api.put('/admin/registration-email-blacklist', { emails: split(emails.value) }); savedEmails.value = result.data.emails.join('\n'); emails.value = savedEmails.value; matches.value = []; notice.value = '黑名单已保存，历史用户状态未变更。' }) }
async function checkMatches() { await run(async () => { matches.value = (await api.post('/admin/registration-email-blacklist/matches')).data.users; notice.value = `发现 ${matches.value.length} 个仍启用的命中用户（最多显示 1000 个）。` }) }
async function disableMatches() { if (!window.confirm(`确认停用下方 ${matches.value.length} 个命中用户？其模型 Key 与 MCP 授权将失效。`)) return; await run(async () => { const { data } = await api.post('/admin/registration-email-blacklist/disable', { ids: matches.value.map(user => user.id), confirm: true }); notice.value = `已停用 ${data.disabled} 个用户。`; matches.value = [] }) }
onMounted(() => { void run(load) })
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <header><a href="/settings" class="text-sm text-primary-600">← 系统设置</a><h1 class="mt-3 text-2xl font-semibold">管理访问与策略</h1><p class="mt-2 text-sm text-gray-500">为运维工具授予所需权限，并管理注册与生图策略。</p></header>
    <p v-if="error" role="alert" class="rounded-lg bg-red-50 p-3 text-red-700">{{ error }}</p>
    <p v-if="notice" role="status" class="rounded-lg bg-green-50 p-3 text-green-800">{{ notice }}</p>
    <section v-if="secret" class="card space-y-3 border border-amber-300 p-5"><h2 class="font-semibold">保存新密钥</h2><p class="text-sm text-gray-500">完整密钥只在本次显示，数据库仅保存摘要。</p><textarea readonly :value="secret" class="input w-full break-all" aria-label="新管理密钥" /><button class="btn-primary" @click="secret = ''">我已保存，关闭显示</button></section>
    <section class="card space-y-4 p-5">
      <h2 class="text-lg font-semibold">受限管理员 API Key</h2>
      <form class="space-y-4" @submit.prevent="createKey">
        <label class="block text-sm">名称<input v-model="name" required maxlength="100" class="input mt-1 w-full" /></label>
        <fieldset><legend class="mb-2 text-sm">允许的操作</legend><div class="grid gap-2 sm:grid-cols-3"><label v-for="permission in permissions" :key="permission" class="flex items-center gap-2 text-sm"><input v-model="selectedPermissions" type="checkbox" :value="permission" />{{ labels[permission] || permission }}</label></div></fieldset>
        <div class="grid gap-4 sm:grid-cols-2"><label class="text-sm">账号 ID 范围<textarea v-model="accountScope" class="input mt-1 w-full" placeholder="留空允许上述操作访问全部账号" /></label><label class="text-sm">分组 ID 范围<textarea v-model="groupScope" class="input mt-1 w-full" placeholder="留空不限制分组；填写后只匹配组内账号" /></label></div>
        <div class="grid gap-4 sm:grid-cols-2"><label class="text-sm">来源 IP 或 CIDR<textarea v-model="ips" class="input mt-1 w-full" placeholder="每行一个；留空不限制来源" /></label><label class="text-sm">有效天数<input v-model.number="days" type="number" min="1" max="365" class="input mt-1 w-full" /></label></div>
        <p class="text-xs text-gray-500">账号与分组范围同时填写时，必须同时满足。用户与审计权限为独立的全站读取权限。通过 x-admin-api-key 调用 /api/management 接口。</p>
        <button class="btn-primary" :disabled="busy || !selectedPermissions.length">创建密钥</button>
      </form>
      <div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr><th class="py-2">名称</th><th>前缀</th><th>有效期</th><th>操作</th></tr></thead><tbody><tr v-for="key in keys" :key="key.id" class="border-t border-gray-200 dark:border-gray-700"><td class="py-3">{{ key.name }}<span v-if="key.revoked_at" class="ml-2 text-gray-500">已撤销</span></td><td>{{ key.prefix }}…</td><td>{{ key.expires_at ? new Date(Number(key.expires_at)).toLocaleDateString() : '永久' }}</td><td><button v-if="!key.revoked_at" class="mr-3 text-primary-600" :disabled="busy" @click="rotate(key.id)">轮换</button><button v-if="!key.revoked_at" class="text-red-600" :disabled="busy" @click="revoke(key.id)">撤销</button></td></tr></tbody></table></div>
    </section>
    <section class="card space-y-4 p-5"><h2 class="text-lg font-semibold">生图账号尺寸</h2><p class="text-sm text-gray-500">为选中的 OpenAI 账号设置可承接的尺寸档位。新账号默认不限。</p><div class="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2"><label v-for="account in accounts" :key="account.id" class="flex items-center gap-2 text-sm"><input v-model="accountIds" type="checkbox" :value="account.id" />{{ account.name }} <span class="text-xs text-gray-500">{{ account.imageSizeTiers?.join('/') || '不限' }}</span></label></div><div class="flex flex-wrap gap-4"><label v-for="tier in ['1K','2K','4K']" :key="tier" class="flex gap-2"><input v-model="tiers" type="checkbox" :value="tier" />{{ tier }}</label></div><button class="btn-primary" :disabled="busy || !accountIds.length || !tiers.length" @click="run(async () => { await api.post('/admin/accounts/bulk-update', { ids: accountIds, patch: { imageSizeTiers: tiers } }); await load(); notice = '尺寸档位已更新。' })">应用到选中账号</button></section>
    <section class="card space-y-4 p-5"><h2 class="text-lg font-semibold">分组图片计费</h2><div class="grid gap-3 sm:grid-cols-2"><select v-model="groupId" class="input" aria-label="计费分组"><option value="">选择分组</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }} · {{ group.imageBillingMode || 'both' }}</option></select><select v-model="billingMode" class="input" aria-label="图片计费方式"><option value="both">Token 加已配置的每张费用</option><option value="tokens">仅 Token</option><option value="per_image">按实际张数（需每张单价）</option></select></div><p class="text-sm text-gray-500">仅作用于专用 OpenAI 图片端点。按张模式未配置模型每张单价时，使用 Token 计费。</p><button class="btn-primary" :disabled="busy || !groupId" @click="run(async () => { await api.patch(`/admin/account-groups/${groupId}`, { imageBillingMode: billingMode }); await load(); notice = '分组计费方式已保存。' })">保存计费方式</button></section>
    <section class="card space-y-4 p-5"><h2 class="text-lg font-semibold">注册邮箱黑名单</h2><p class="text-sm text-gray-500">每行一个邮箱。Gmail 的点号、加号及 googlemail 别名按同一收件箱匹配。保存名单后，可预览并单独确认停用历史用户。</p><textarea v-model="emails" rows="7" maxlength="6000000" class="input w-full" aria-label="邮箱黑名单" /><div class="flex flex-wrap gap-3"><button class="btn-primary" :disabled="busy" @click="saveBlacklist">保存名单</button><button class="btn-secondary" :disabled="busy" @click="checkMatches">检查已注册用户</button></div><div v-if="matches.length" class="space-y-3"><ul class="max-h-48 overflow-y-auto text-sm"><li v-for="user in matches" :key="user.id" class="py-1">{{ user.email }} · {{ user.name }} · {{ user.id }}</li></ul><button class="btn-secondary text-red-700" :disabled="busy" @click="disableMatches">确认停用以上用户</button></div></section>
    <section class="card space-y-4 p-5"><h2 class="text-lg font-semibold">管理 MCP</h2><p class="text-sm text-gray-500">支持浏览器 OAuth 授权和只读查询，可随时撤销授权应用。</p><a class="text-primary-600" href="/mcp/authorize">打开 MCP 接入与授权管理 →</a></section>
    <section class="card space-y-4 p-5"><h2 class="text-lg font-semibold">管理操作审计</h2><div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr><th>时间</th><th>身份</th><th>操作</th><th>状态</th></tr></thead><tbody><tr v-for="entry in audit" :key="entry.id" class="border-t border-gray-200 dark:border-gray-700"><td class="py-2">{{ new Date(Number(entry.created_at)).toLocaleString() }}</td><td class="max-w-40 truncate">{{ entry.actor }}</td><td>{{ entry.operation }}</td><td>{{ entry.status }}</td></tr></tbody></table></div><div class="flex items-center gap-3"><button :disabled="auditPage === 1 || busy" @click="auditPage--; run(loadAudit)">上一页</button><span>{{ auditPage }}</span><button :disabled="audit.length < 25 || busy" @click="auditPage++; run(loadAudit)">下一页</button></div></section>
  </div>
</template>
