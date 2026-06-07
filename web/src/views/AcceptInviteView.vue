<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from '../composables/useMessage'
import { api, errMsg } from '../api/client'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const auth = useAuthStore()

const token = computed(() => String(route.query.token ?? ''))
const name = ref('')
const password = ref('')
const loading = ref(false)

async function accept() {
  if (!token.value) {
    message.error('邀请链接无效')
    return
  }
  if (password.value.length < 6) {
    message.warning('密码至少 6 位')
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
    message.error(errMsg(e, '接受邀请失败'))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="accept-wrap">
    <UiCard class="accept-card" :bordered="false">
      <div class="head">
        <strong>接受邀请</strong>
        <span>Model Bridge</span>
      </div>
      <UiAlert v-if="!token" type="error" style="margin-bottom: 14px">邀请链接缺少 token。</UiAlert>
      <UiForm label-placement="top">
        <UiFormItem label="名称">
          <UiInput v-model:value="name" placeholder="可稍后修改" />
        </UiFormItem>
        <UiFormItem label="密码">
          <UiInput
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="至少 6 位"
            @keyup.enter="accept"
          />
        </UiFormItem>
        <UiButton type="primary" block :loading="loading" :disabled="!token" @click="accept">创建账户</UiButton>
      </UiForm>
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
  background: #f6f8fb;
}

.accept-card {
  width: min(420px, 100%);
  border-radius: 8px;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.1);
}

.head {
  margin-bottom: 22px;
}

.head strong,
.head span {
  display: block;
}

.head strong {
  color: #0f172a;
  font-size: 22px;
}

.head span {
  margin-top: 4px;
  color: rgba(15, 23, 42, 0.54);
  font-size: 13px;
}
</style>
