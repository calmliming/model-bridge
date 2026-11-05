<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, errMsg } from '../api/client'
import { useAuthStore } from '../stores/auth'

const route = useRoute(), auth = useAuthStore()
const error = ref(''), busy = ref(false), grants = ref<any[]>([]), config = ref<{ url: string | null }>({ url: null })
const preview = ref<{ clientName: string; redirectUri: string; role: string } | null>(null), adminScope = ref(false)
const authorization = computed(() => Object.fromEntries(Object.entries(route.query).filter(([key]) => ['client_id','redirect_uri','resource','response_type','code_challenge','code_challenge_method','state','scope'].includes(key))))
const isConsent = computed(() => !!route.query.client_id)
const loginUrl = computed(() => '/login?returnTo=' + encodeURIComponent(route.fullPath))
async function load() {
  error.value = ''; preview.value = null
  if (!auth.isAuthenticated) return
  busy.value = true
  try {
    const [c, g] = await Promise.all([api.get('/mcp/config'), api.get('/mcp/grants')])
    config.value = c.data; grants.value = g.data.grants
    if (isConsent.value) preview.value = (await api.post('/mcp/oauth/preview', authorization.value)).data
  } catch (e) { error.value = errMsg(e) } finally { busy.value = false }
}
async function decide(allow: boolean) {
  busy.value = true; error.value = ''
  try { const { data } = await api.post('/mcp/oauth/consent', { authorization: authorization.value, allow, adminScope: adminScope.value }); window.location.assign(data.redirect) }
  catch (e) { error.value = errMsg(e); busy.value = false }
}
async function revoke(id: string) {
  busy.value = true
  try { await api.delete(`/mcp/grants/${id}`); await load() } catch (e) { error.value = errMsg(e) } finally { busy.value = false }
}
onMounted(() => { if (localStorage.getItem('mb_user_token')) auth.activateRole('user'); void load() })
</script>
<template>
  <main class="mx-auto max-w-2xl space-y-6 p-5 sm:py-12">
    <header><a :href="auth.isAdmin ? '/management' : '/app'" class="text-sm text-primary-600">← 返回控制台</a><h1 class="mt-4 text-2xl font-semibold">MCP 接入与授权</h1><p class="mt-2 text-sm text-gray-500">通过 OAuth 连接支持 MCP 的应用，查询用量、余额和账号状态。</p></header>
    <p v-if="error" role="alert" class="rounded-lg bg-red-50 p-3 text-red-700">{{ error }}</p>
    <section class="card space-y-4 p-5"><label class="block text-sm">登录身份<select :value="auth.role" class="input ml-3" @change="auth.activateRole(($event.target as HTMLSelectElement).value as 'admin' | 'user'); adminScope = false; load()"><option value="user">个人用户</option><option value="admin">管理员</option></select></label><a v-if="!auth.isAuthenticated" :href="loginUrl" class="btn-primary inline-block">登录后继续</a><template v-else><p class="text-sm">当前登录：{{ auth.username }}</p><p v-if="config.url" class="break-all rounded-lg bg-gray-50 p-3 font-mono text-sm dark:bg-gray-900">{{ config.url }}</p><p v-else class="text-sm text-gray-500">服务尚未启用。管理员可配置 MCP_PUBLIC_URL 后重启服务。</p></template></section>
    <section v-if="preview" class="card space-y-4 p-5"><h2 class="text-lg font-semibold">允许 {{ preview.clientName }} 访问？</h2><p class="text-sm">默认只读访问你的资料、余额、用量、Key 元数据和订阅。</p><p class="text-sm text-gray-500">应用名称由连接方提供，请确认名称和返回地址。</p><p class="break-all text-sm text-gray-500">返回地址：{{ preview.redirectUri }}</p><label v-if="auth.isAdmin" class="flex items-start gap-2 text-sm"><input v-model="adminScope" type="checkbox" class="mt-1" />同时授予平台账号状态和全站用量的管理员只读权限</label><p class="text-sm text-gray-500">应用不会获得模型密钥、上游凭据或修改权限。可在下方随时撤销。</p><div class="flex gap-3"><button class="btn-primary" :disabled="busy" @click="decide(true)">允许只读访问</button><button class="btn-secondary" :disabled="busy" @click="decide(false)">拒绝</button></div></section>
    <section v-if="auth.isAuthenticated" class="card space-y-4 p-5"><h2 class="text-lg font-semibold">已授权应用</h2><p v-if="!grants.length" class="text-sm text-gray-500">暂无授权应用。</p><article v-for="grant in grants" :key="grant.id" class="flex items-center justify-between gap-4 border-t border-gray-200 py-3 dark:border-gray-700"><div class="min-w-0"><p class="truncate font-medium">{{ grant.client_name }}</p><p class="mt-1 text-xs text-gray-500">{{ grant.role === 'admin' ? '管理员只读' : '个人只读' }} · {{ grant.revoked_at ? '已撤销' : '到期：' + new Date(Number(grant.expires_at)).toLocaleDateString() }}</p></div><button v-if="!grant.revoked_at" class="text-sm text-red-600" :disabled="busy" @click="revoke(grant.id)">撤销</button></article></section>
  </main>
</template>
