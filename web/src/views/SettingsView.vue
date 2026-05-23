<script setup lang="ts">
import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { useAuthStore } from '../stores/auth'

const message = useMessage()
const auth = useAuthStore()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const saving = ref(false)

async function changePassword() {
  if (!currentPassword.value || !newPassword.value) {
    message.warning('请填写完整')
    return
  }
  if (newPassword.value.length < 6) {
    message.warning('新密码至少 6 位')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    message.warning('两次输入的新密码不一致')
    return
  }
  saving.value = true
  try {
    await api.post('/admin/change-password', {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    })
    message.success('密码已更新')
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (e) {
    message.error(errMsg(e, '修改失败'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">设置</h2>
        <div class="page-subtitle">维护管理员账户和控制台访问安全。</div>
      </div>
    </div>

    <n-card class="settings-card surface-card" title="管理员账户" :bordered="false">
      <n-form label-placement="top">
        <n-form-item label="当前用户">
          <n-input :value="auth.username ?? ''" readonly />
        </n-form-item>
        <n-form-item label="当前密码">
          <n-input v-model:value="currentPassword" type="password" show-password-on="click" />
        </n-form-item>
        <n-form-item label="新密码">
          <n-input v-model:value="newPassword" type="password" show-password-on="click" />
        </n-form-item>
        <n-form-item label="确认新密码">
          <n-input
            v-model:value="confirmPassword"
            type="password"
            show-password-on="click"
            @keyup.enter="changePassword"
          />
        </n-form-item>
        <n-button type="primary" :loading="saving" @click="changePassword">更新密码</n-button>
      </n-form>
    </n-card>
  </div>
</template>

<style scoped>
.settings-card {
  max-width: 520px;
}
</style>
