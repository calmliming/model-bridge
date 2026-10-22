<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { api, errMsg } from '../api/client'
import { useAuthStore } from '../stores/auth'
import BrandLogo from '../components/BrandLogo.vue'
import { formatTime } from '../utils'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const token = computed(() => String(route.query.token ?? ''))
const name = ref('')
const password = ref('')
const loading = ref(false)
const verifying = ref(false)
const invite = ref<{ email: string; name: string; expiresAt: number } | null>(null)
const inviteError = ref('')
const passwordError = ref('')
let version = 0

async function loadInvite() {
  const current = ++version
  invite.value = null; password.value = ''; passwordError.value = ''; inviteError.value = ''; verifying.value = false
  if (!token.value) { inviteError.value = '邀请链接不完整，请联系邀请人重新发送。'; return }
  verifying.value = true
  try {
    const { data } = await api.post('/users/invites/preview', { token: token.value })
    if (current !== version) return
    invite.value = data; name.value = data.name || ''
  } catch (error) {
    if (current === version) inviteError.value = errMsg(error, '暂时无法验证邀请，请稍后重试。')
  } finally { if (current === version) verifying.value = false }
}
watch(token, loadInvite, { immediate: true })

async function accept() {
  if (!invite.value || loading.value) return
  if (password.value.length < 6 || new TextEncoder().encode(password.value).length > 72) {
    passwordError.value = '密码至少 6 个字符，且不超过 72 个 UTF-8 字节'
    await nextTick(); document.getElementById('invite-password')?.focus()
    return
  }
  loading.value = true
  try {
    const { data } = await api.post('/users/invites/accept', {
      token: token.value,
      name: name.value.trim() || undefined,
      password: password.value,
    })
    auth.setSession(data.token, data.user.email, 'user')
    void router.push({ name: 'user-overview' })
  } catch (e) {
    const error = errMsg(e, '接受邀请失败，请刷新链接状态后重试')
    if (['invalid invite token', 'invite already used', 'invite expired', 'user is disabled'].includes(error)) {
      invite.value = null; inviteError.value = '邀请已失效，请联系邀请人重新发送。'
    } else passwordError.value = error
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="accept-wrap">
    <UiCard class="accept-card" :bordered="false">
      <div class="head">
        <BrandLogo :size="40" />
        <div>
          <h1>接受邀请</h1>
          <span>Model Bridge</span>
        </div>
      </div>
      <p v-if="verifying" role="status" class="py-6 text-center text-sm text-gray-500">正在验证邀请…</p>
      <div v-else-if="inviteError" class="space-y-4">
        <UiAlert type="error">{{ inviteError }}</UiAlert>
        <div class="flex flex-wrap gap-3"><RouterLink to="/login" class="btn btn-primary">返回登录</RouterLink><UiButton v-if="token" @click="loadInvite">重新验证</UiButton></div>
      </div>
      <template v-else-if="invite">
      <div class="mb-5 rounded-xl bg-primary-50 p-3 text-sm text-primary-800 dark:bg-primary-900/20 dark:text-primary-200"><p class="break-all">受邀邮箱：<strong>{{ invite.email }}</strong></p><p class="mt-1 text-xs">有效至 {{ formatTime(invite.expiresAt) }}</p></div>
      <UiForm label-placement="top" novalidate @submit="accept">
        <UiFormItem label="名称">
          <UiInput v-model:value="name" placeholder="可稍后修改" />
        </UiFormItem>
        <UiFormItem label="设置密码" for-id="invite-password" :error="passwordError">
          <UiInput
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="至少 6 位"
            autocomplete="new-password"
            @update:value="passwordError = ''"
          />
        </UiFormItem>
        <UiButton type="primary" block native-type="submit" :loading="loading">设置密码并进入</UiButton>
      </UiForm>
      <RouterLink to="/login" class="mt-5 block text-center text-sm text-primary-700 hover:underline">已有账号？返回登录</RouterLink>
      </template>
    </UiCard>
  </div>
</template>

<style scoped>
.accept-wrap {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: linear-gradient(135deg, #f8fbff, #effcf9);
}

.accept-card {
  width: min(420px, 100%);
  border-radius: 24px;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.1);
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 22px;
}

.head h1,
.head span {
  display: block;
}

.head h1 {
  color: #0f172a;
  font-size: 22px;
}

.head span {
  margin-top: 4px;
  color: rgba(15, 23, 42, 0.54);
  font-size: 13px;
}
</style>
