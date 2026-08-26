<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from '../composables/useMessage'
import { api, errMsg } from '../api/client'
import { useAuthStore } from '../stores/auth'
import TurnstileWidget from '../components/TurnstileWidget.vue'

const router = useRouter()
const message = useMessage()
const auth = useAuthStore()

const account = ref('')
const password = ref('')
const loading = ref(false)
const turnstileSiteKey = ref<string | null>(null)
const turnstileToken = ref('')
const turnstileRef = ref<{ reset: () => void } | null>(null)
const captchaMissing = computed(() => !!turnstileSiteKey.value && !turnstileToken.value)

// Registration
const mode = ref<'login' | 'register'>('login')
const registrationEnabled = ref(false)
const regEmail = ref('')
const regPassword = ref('')
const regConfirm = ref('')
const regName = ref('')

onMounted(async () => {
  try {
    const { data } = await api.get('/auth/registration-status')
    registrationEnabled.value = !!data.enabled
    turnstileSiteKey.value = typeof data.turnstileSiteKey === 'string' && data.turnstileSiteKey
      ? data.turnstileSiteKey
      : null
  } catch {
    // 注册入口仅为可选展示，状态拉取失败时静默隐藏
  }
})

function resetTurnstile() {
  turnstileToken.value = ''
  turnstileRef.value?.reset()
}

function setMode(next: 'login' | 'register') {
  mode.value = next
  resetTurnstile()
}

async function login() {
  const accountValue = account.value.trim()
  if (!accountValue || !password.value) {
    message.warning('请输入账号和密码')
    return
  }
  if (captchaMissing.value) {
    message.warning('请先完成人机验证')
    return
  }
  loading.value = true
  try {
    const { data } = await api.post('/auth/login', {
      account: accountValue,
      password: password.value,
      turnstileToken: turnstileToken.value || undefined,
    })
    if (data.role === 'admin') {
      auth.setSession(data.token, data.username, 'admin')
      void router.push({ name: 'overview' })
    } else {
      auth.setSession(data.token, data.user.email, 'user')
      void router.push({ name: 'user-overview' })
    }
  } catch (e) {
    resetTurnstile()
    message.error(errMsg(e, '登录失败'))
  } finally {
    loading.value = false
  }
}

async function register() {
  const email = regEmail.value.trim()
  if (!email || !regPassword.value) {
    message.warning('请输入邮箱和密码')
    return
  }
  if (regPassword.value.length < 6) {
    message.warning('密码至少 6 位')
    return
  }
  if (regPassword.value !== regConfirm.value) {
    message.warning('两次输入的密码不一致')
    return
  }
  if (captchaMissing.value) {
    message.warning('请先完成人机验证')
    return
  }
  loading.value = true
  try {
    const { data } = await api.post('/auth/register', {
      email,
      password: regPassword.value,
      name: regName.value.trim() || undefined,
      turnstileToken: turnstileToken.value || undefined,
    })
    auth.setSession(data.token, data.user.email, 'user')
    message.success('注册成功')
    void router.push({ name: 'user-overview' })
  } catch (e) {
    resetTurnstile()
    message.error(errMsg(e, '注册失败'))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="ambient-grid" />
    <div class="login-shell">
      <div class="login-brand">
        <span class="brand-mark">
          <span />
        </span>
        <span>Model Bridge</span>
      </div>

      <section class="login-main">
        <div class="hero-copy">
          <div class="hero-kicker">AI API Gateway</div>
          <h1>统一登录</h1>
          <p>管理员和受邀用户从同一个入口进入各自的控制台。</p>
        </div>

        <div class="preview-panel">
          <div class="preview-topbar">
            <span />
            <span />
            <span />
          </div>
          <div class="preview-row is-active">
            <span>Claude</span>
            <strong>Online</strong>
          </div>
          <div class="preview-row">
            <span>API Keys</span>
            <strong>Ready</strong>
          </div>
          <div class="preview-chart">
            <span class="bar is-low" />
            <span class="bar" />
            <span class="bar is-tall" />
            <span class="bar is-mid" />
            <span class="bar is-high" />
            <span class="bar" />
          </div>
        </div>
      </section>

      <main class="login-card">
        <div class="login-card-inner">
        <div class="form-head">
          <div>
            <div class="form-eyebrow">Unified Console</div>
            <h2>{{ mode === 'login' ? '欢迎回来' : '创建账号' }}</h2>
          </div>
          <span class="secure-badge">Secure</span>
        </div>

        <UiForm v-if="mode === 'login'" label-placement="top" novalidate class="login-form" @submit="login">
          <UiFormItem label="账号" for-id="login-account">
            <UiInput
              id="login-account"
              name="account"
              v-model:value="account"
              size="large"
              placeholder="请输入账号"
              autocomplete="username"
              required
            />
          </UiFormItem>
          <UiFormItem label="密码" for-id="login-password">
            <UiInput
              id="login-password"
              name="password"
              v-model:value="password"
              size="large"
              type="password"
              show-password-on="click"
              placeholder="请输入密码"
              autocomplete="current-password"
              required
            />
          </UiFormItem>
          <TurnstileWidget
            v-if="turnstileSiteKey"
            ref="turnstileRef"
            :site-key="turnstileSiteKey"
            @update:token="turnstileToken = $event"
          />
          <UiButton type="primary" size="large" block native-type="submit" :loading="loading" :disabled="captchaMissing">
            登录
          </UiButton>
          <p v-if="registrationEnabled" class="form-switch">
            还没有账号？<button type="button" class="form-switch-link" @click="setMode('register')">注册账号</button>
          </p>
        </UiForm>

        <UiForm v-else label-placement="top" novalidate class="login-form" @submit="register">
          <UiFormItem label="邮箱" for-id="register-email">
            <UiInput
              id="register-email"
              name="email"
              v-model:value="regEmail"
              size="large"
              placeholder="请输入邮箱"
              autocomplete="email"
              required
            />
          </UiFormItem>
          <UiFormItem label="昵称（可选）" for-id="register-name">
            <UiInput
              id="register-name"
              name="name"
              v-model:value="regName"
              size="large"
              placeholder="如何称呼你"
              autocomplete="name"
            />
          </UiFormItem>
          <UiFormItem label="密码" for-id="register-password">
            <UiInput
              id="register-password"
              name="password"
              v-model:value="regPassword"
              size="large"
              type="password"
              show-password-on="click"
              placeholder="至少 6 位"
              autocomplete="new-password"
              required
            />
          </UiFormItem>
          <UiFormItem label="确认密码" for-id="register-confirm">
            <UiInput
              id="register-confirm"
              name="passwordConfirmation"
              v-model:value="regConfirm"
              size="large"
              type="password"
              show-password-on="click"
              placeholder="再次输入密码"
              autocomplete="new-password"
              required
            />
          </UiFormItem>
          <TurnstileWidget
            v-if="turnstileSiteKey"
            ref="turnstileRef"
            :site-key="turnstileSiteKey"
            @update:token="turnstileToken = $event"
          />
          <UiButton type="primary" size="large" block native-type="submit" :loading="loading" :disabled="captchaMissing">
            注册
          </UiButton>
          <p class="form-switch">
            已有账号？<button type="button" class="form-switch-link" @click="setMode('login')">返回登录</button>
          </p>
        </UiForm>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  position: relative;
  height: 100vh;
  height: 100dvh;
  display: grid;
  place-items: center;
  padding: 32px;
  overflow: hidden;
  color: #111827;
  background:
    linear-gradient(115deg, rgba(255, 255, 255, 0.92), rgba(245, 249, 255, 0.78) 54%, rgba(239, 252, 250, 0.82)),
    linear-gradient(180deg, #f8fbff, #eef4f8);
}

.ambient-grid {
  position: absolute;
  inset: 0;
  opacity: 0.72;
  pointer-events: none;
  background:
    linear-gradient(rgba(24, 31, 45, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(24, 31, 45, 0.055) 1px, transparent 1px),
    linear-gradient(115deg, transparent 0 45%, rgba(56, 189, 248, 0.14) 45% 46%, transparent 46% 100%),
    linear-gradient(65deg, transparent 0 58%, rgba(20, 184, 166, 0.14) 58% 59%, transparent 59% 100%);
  background-size:
    48px 48px,
    48px 48px,
    100% 100%,
    100% 100%;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.9), transparent 86%);
}

.login-shell {
  position: relative;
  z-index: 1;
  width: min(1080px, 100%);
  min-height: min(640px, calc(100dvh - 64px));
  display: grid;
  grid-template-columns: minmax(0, 1fr) 390px;
  gap: 42px;
  align-items: center;
}

.login-brand {
  position: absolute;
  top: 0;
  left: 0;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: #111827;
  font-size: 18px;
  font-weight: 760;
  letter-spacing: 0;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
}

.brand-mark span {
  width: 16px;
  height: 16px;
  border-radius: 5px;
  background: linear-gradient(135deg, #00c2a8, #4f7cff);
  transform: rotate(45deg);
}

.login-main {
  position: relative;
  min-height: 520px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-top: 56px;
}

.login-main::before {
  content: '';
  position: absolute;
  width: min(520px, 80%);
  height: 1px;
  left: 0;
  top: 46%;
  background: linear-gradient(90deg, rgba(20, 184, 166, 0), rgba(20, 184, 166, 0.6), rgba(79, 124, 255, 0));
  pointer-events: none;
}

.hero-copy {
  position: relative;
  z-index: 1;
  max-width: 560px;
  margin-bottom: 42px;
}

.hero-kicker,
.form-eyebrow {
  font-size: 12px;
  font-weight: 760;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.hero-kicker {
  color: #0d9488;
  margin-bottom: 16px;
}

.hero-copy h1 {
  margin: 0;
  color: #0f172a;
  font-size: 64px;
  line-height: 1.02;
  font-weight: 820;
  letter-spacing: 0;
}

.hero-copy p {
  margin: 20px 0 0;
  max-width: 440px;
  color: rgba(15, 23, 42, 0.62);
  font-size: 17px;
  line-height: 1.75;
}

.preview-panel {
  position: relative;
  z-index: 1;
  width: min(440px, 100%);
  padding: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.58);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.1);
  backdrop-filter: blur(16px);
}

.preview-topbar,
.preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-topbar {
  margin-bottom: 18px;
}

.preview-topbar span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.2);
}

.preview-row {
  justify-content: space-between;
  min-height: 46px;
  padding: 0 14px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 14px;
  color: rgba(15, 23, 42, 0.58);
  background: rgba(255, 255, 255, 0.62);
  font-size: 13px;
}

.preview-row + .preview-row {
  margin-top: 10px;
}

.preview-row strong {
  color: #0f766e;
  font-size: 12px;
}

.preview-row.is-active {
  border-color: rgba(20, 184, 166, 0.18);
  background: rgba(236, 253, 245, 0.62);
}

.preview-chart {
  height: 112px;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  align-items: end;
  gap: 10px;
  margin-top: 18px;
  padding: 16px 12px 8px;
  border-radius: 16px;
  background:
    linear-gradient(rgba(15, 23, 42, 0.05) 1px, transparent 1px),
    rgba(248, 250, 252, 0.58);
  background-size: 100% 28px;
}

.bar {
  height: 58%;
  border-radius: 999px 999px 4px 4px;
  background: linear-gradient(180deg, #4f7cff, #14b8a6);
}

.bar.is-low {
  height: 34%;
}

.bar.is-mid {
  height: 48%;
}

.bar.is-tall {
  height: 82%;
}

.bar.is-high {
  height: 68%;
}

.login-card {
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 28px 90px rgba(15, 23, 42, 0.14);
  backdrop-filter: blur(22px);
}

.login-card-inner {
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 494px;
  padding: 42px;
}

.form-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 28px;
}

.form-eyebrow {
  color: #0d9488;
  margin-bottom: 8px;
}

.form-head h2 {
  margin: 0;
  color: #0f172a;
  font-size: 30px;
  line-height: 1.25;
  letter-spacing: 0;
}

.secure-badge {
  flex: 0 0 auto;
  padding: 7px 10px;
  border: 1px solid rgba(20, 184, 166, 0.22);
  border-radius: 999px;
  color: #0f766e;
  background: rgba(240, 253, 250, 0.8);
  font-size: 12px;
  font-weight: 760;
}

.login-form {
  margin-top: 2px;
}

.form-switch {
  margin: 16px 0 0;
  text-align: center;
  color: rgba(15, 23, 42, 0.6);
  font-size: 14px;
}

.form-switch-link {
  border: 0;
  padding: 0;
  color: #0d9488;
  background: transparent;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.form-switch-link:hover {
  text-decoration: underline;
}

.form-switch-link:focus-visible {
  outline: 2px solid rgba(13, 148, 136, 0.45);
  outline-offset: 3px;
  border-radius: 4px;
}

.login-form :deep(.field-label) {
  color: rgba(23, 32, 51, 0.72);
  font-weight: 600;
}

.login-form :deep(.btn) {
  margin-top: 8px;
  font-weight: 700;
}

@media (max-width: 900px) {
  .login-wrap {
    height: auto;
    min-height: 100vh;
    min-height: 100dvh;
    padding: 18px;
    overflow: auto;
  }

  .login-shell {
    grid-template-columns: 1fr;
    gap: 28px;
    min-height: auto;
  }

  .login-brand {
    position: static;
  }

  .login-main {
    min-height: auto;
    padding-top: 18px;
  }

  .hero-copy {
    margin-bottom: 30px;
  }

  .hero-copy h1 {
    font-size: 46px;
  }

  .login-card-inner {
    min-height: auto;
    padding: 32px 26px 28px;
  }
}

@media (max-width: 480px) {
  .login-wrap {
    padding: 18px;
  }

  .login-shell {
    gap: 22px;
  }

  .hero-copy {
    margin-bottom: 22px;
  }

  .hero-copy h1 {
    font-size: 38px;
  }

  .hero-copy p {
    font-size: 15px;
  }

  .preview-panel {
    display: none;
  }

  .secure-badge {
    display: none;
  }

  .form-head h2 {
    font-size: 25px;
  }
}
</style>
