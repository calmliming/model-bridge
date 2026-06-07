<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useMessage } from '../composables/useMessage'
import { api, errMsg } from '../api/client'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const message = useMessage()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const loading = ref(false)

async function login() {
  if (!email.value || !password.value) {
    message.warning('请输入邮箱和密码')
    return
  }
  loading.value = true
  try {
    const { data } = await api.post('/users/login', {
      email: email.value,
      password: password.value,
    })
    auth.setSession(data.token, data.user.email, 'user')
    void router.push({ name: 'user-overview' })
  } catch (e) {
    message.error(errMsg(e, '登录失败'))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <UiCard class="login-card" :bordered="false">
      <div class="brand">
        <span class="brand-mark"><span /></span>
        <div>
          <strong>Model Bridge</strong>
          <small>User Console</small>
        </div>
      </div>
      <UiForm label-placement="top">
        <UiFormItem label="邮箱">
          <UiInput v-model:value="email" size="large" placeholder="user@example.com" />
        </UiFormItem>
        <UiFormItem label="密码">
          <UiInput
            v-model:value="password"
            size="large"
            type="password"
            show-password-on="click"
            placeholder="请输入密码"
            @keyup.enter="login"
          />
        </UiFormItem>
        <UiButton type="primary" size="large" block :loading="loading" @click="login">登录</UiButton>
      </UiForm>
      <div class="links">
        <RouterLink to="/login">管理员入口</RouterLink>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    linear-gradient(115deg, rgba(255, 255, 255, 0.94), rgba(240, 249, 255, 0.82)),
    #eef4f8;
}

.login-card {
  width: min(420px, 100%);
  border-radius: 8px;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.12);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: #0f172a;
}

.brand-mark span {
  width: 15px;
  height: 15px;
  border-radius: 4px;
  background: linear-gradient(135deg, #22c55e, #38bdf8);
  transform: rotate(45deg);
}

.brand strong,
.brand small {
  display: block;
}

.brand strong {
  color: #0f172a;
  font-size: 18px;
}

.brand small,
.links {
  color: rgba(15, 23, 42, 0.54);
  font-size: 12px;
}

.links {
  margin-top: 16px;
  text-align: center;
}
</style>
