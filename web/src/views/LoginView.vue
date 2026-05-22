<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const message = useMessage()
const auth = useAuthStore()

const username = ref('admin')
const password = ref('')
const loading = ref(false)

async function login() {
  if (!username.value || !password.value) {
    message.warning('请输入用户名和密码')
    return
  }
  loading.value = true
  try {
    const { data } = await api.post('/admin/login', {
      username: username.value,
      password: password.value,
    })
    auth.setSession(data.token, data.username)
    void router.push({ name: 'overview' })
  } catch (e) {
    message.error(errMsg(e, '登录失败'))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <n-card class="login-card">
      <div class="login-brand">
        <span class="brand-dot" />
        <span>model-bridge</span>
      </div>
      <div class="login-sub">AI API 中转平台 · 管理后台</div>
      <n-form label-placement="top">
        <n-form-item label="用户名">
          <n-input v-model:value="username" placeholder="admin" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="请输入密码"
            @keyup.enter="login"
          />
        </n-form-item>
        <n-button type="primary" block :loading="loading" @click="login">登录</n-button>
      </n-form>
    </n-card>
  </div>
</template>

<style scoped>
.login-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: radial-gradient(1100px 560px at 50% -12%, rgba(91, 140, 255, 0.2), transparent);
}
.login-card {
  width: 364px;
}
.login-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 22px;
  font-weight: 700;
}
.brand-dot {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5b8cff, #9d7bff);
}
.login-sub {
  opacity: 0.6;
  font-size: 13px;
  margin: 6px 0 22px;
}
</style>
