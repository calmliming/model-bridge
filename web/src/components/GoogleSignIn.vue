<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import axios from 'axios'
import { api, errMsg } from '../api/client'

interface GoogleIdApi {
  initialize: (options: {
    client_id: string; nonce: string; auto_select: boolean; ux_mode: 'popup'
    callback: (response: { credential: string }) => void
  }) => void
  renderButton: (element: HTMLElement, options: {
    type: 'standard'; theme: 'outline'; size: 'large'; text: 'signin_with'; locale: string; width: number
  }) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } }
    __modelBridgeGoogleLoading?: Promise<void>
  }
}

const props = defineProps<{ clientId: string; disabled?: boolean }>()
const emit = defineEmits<{
  success: [session: { token: string; user: { email: string } }]
  busy: [value: boolean]
}>()
const container = ref<HTMLElement | null>(null)
const preparing = ref(true)
const submitting = ref(false)
const error = ref('')
const needsPassword = ref(false)
const password = ref('')
const ready = ref(false)
let credential = ''
let disposed = false
let expires: ReturnType<typeof setTimeout> | undefined

function loadGoogle(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve()
  if (window.__modelBridgeGoogleLoading) return window.__modelBridgeGoogleLoading
  window.__modelBridgeGoogleLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    const timer = setTimeout(() => fail(), 15_000)
    function fail() {
      clearTimeout(timer)
      script.remove()
      reject(new Error('Google 登录组件加载失败'))
    }
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.referrerPolicy = 'strict-origin-when-cross-origin'
    script.onload = () => {
      clearTimeout(timer)
      if (window.google?.accounts.id) resolve()
      else fail()
    }
    script.onerror = fail
    document.head.appendChild(script)
  }).catch(error => {
    window.__modelBridgeGoogleLoading = undefined
    throw error
  })
  return window.__modelBridgeGoogleLoading
}

async function prepare() {
  if (submitting.value || disposed) return
  clearTimeout(expires)
  error.value = ''
  credential = ''
  password.value = ''
  needsPassword.value = false
  preparing.value = true
  ready.value = false
  try {
    await loadGoogle()
    if (disposed) return
    const { data } = await api.post('/auth/google/challenge', {}, { timeout: 15_000 })
    if (disposed) return
    ready.value = true
    preparing.value = false
    await nextTick()
    if (!container.value || !window.google?.accounts.id) return
    container.value.replaceChildren()
    window.google.accounts.id.initialize({
      client_id: props.clientId,
      nonce: data.nonce,
      auto_select: false,
      ux_mode: 'popup',
      callback: (response) => {
        if (disposed || submitting.value || props.disabled || !ready.value) return
        credential = response.credential
        void submit()
      },
    })
    window.google.accounts.id.renderButton(container.value, {
      type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', locale: 'zh_CN',
      width: Math.min(400, Math.max(200, Math.floor(container.value.clientWidth))),
    })
    expires = setTimeout(() => {
      ready.value = false
      credential = ''
      password.value = ''
      needsPassword.value = false
      error.value = 'Google 登录已过期，请点击重试'
    }, data.expiresIn * 1000)
  } catch (e) {
    error.value = errMsg(e, '无法加载 Google 登录，请检查网络后重试')
  } finally {
    if (!disposed) preparing.value = false
  }
}

async function submit() {
  if (!credential || submitting.value || props.disabled) return
  if (needsPassword.value && !password.value) {
    error.value = '请输入原账号密码'
    return
  }
  submitting.value = true
  emit('busy', true)
  error.value = ''
  try {
    const { data } = await api.post('/auth/google', {
      credential, password: needsPassword.value ? password.value : undefined,
    }, { timeout: 20_000 })
    if (disposed) return
    clearTimeout(expires)
    credential = ''
    password.value = ''
    emit('success', data)
  } catch (e) {
    if (disposed) return
    if (axios.isAxiosError(e) && e.response?.data?.code === 'google_link_required') {
      needsPassword.value = true
    } else {
      error.value = errMsg(e, 'Google 登录失败，请重试')
      if (!needsPassword.value || !axios.isAxiosError(e) || e.response?.status !== 400) {
        ready.value = false
        needsPassword.value = false
        credential = ''
      }
    }
    password.value = ''
  } finally {
    submitting.value = false
    emit('busy', false)
  }
}

onMounted(() => { void prepare() })
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(expires)
  credential = ''
  password.value = ''
})
</script>

<template>
  <div class="google-sign-in" :aria-busy="preparing || submitting">
    <div class="google-divider"><span>或使用 Google 账号</span></div>
    <p v-if="preparing || submitting" class="google-status" role="status">
      {{ preparing ? '正在加载 Google 登录…' : '正在验证 Google 账号…' }}
    </p>
    <div v-show="ready && !needsPassword && !preparing && !submitting" :inert="disabled || undefined" class="google-button" ref="container" />
    <form v-if="needsPassword" class="google-link" @submit.prevent="submit">
      <p>该邮箱已有账号，验证原密码后即可使用 Google 登录。</p>
      <label for="google-link-password">原账号密码</label>
      <input id="google-link-password" v-model="password" type="password" autocomplete="current-password" required :disabled="submitting || disabled" />
      <UiButton block type="primary" native-type="submit" :loading="submitting" :disabled="disabled">验证并绑定 Google</UiButton>
    </form>
    <p v-if="error" class="google-error" role="alert">{{ error }}</p>
    <button v-if="!preparing && !submitting && (!ready || needsPassword)" class="google-retry" type="button" :disabled="disabled" @click="prepare">
      {{ needsPassword ? '返回 Google 登录' : '重试 Google 登录' }}
    </button>
  </div>
</template>

<style scoped>
.google-sign-in { margin-top: 24px; }
.google-divider { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; color: #64748b; font-size: 12px; }
.google-divider::before, .google-divider::after { content: ''; flex: 1; height: 1px; background: #e2e8f0; }
.google-button { min-height: 44px; }
.google-status, .google-error, .google-link p { font-size: 13px; line-height: 1.6; margin: 0 0 12px; color: #64748b; }
.google-error { color: #b91c1c; }
.google-link { display: grid; gap: 10px; }
.google-link label { font-size: 13px; color: #334155; }
.google-link input { width: 100%; min-height: 42px; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: white; color: #0f172a; }
.google-link input:focus-visible, .google-retry:focus-visible { outline: 2px solid #0d9488; outline-offset: 3px; }
.google-retry { display: block; margin: 12px auto 0; border: 0; padding: 4px; background: transparent; color: #0f766e; font-size: 13px; cursor: pointer; }
</style>
