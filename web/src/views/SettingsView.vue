<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { useAuthStore } from '../stores/auth'

const message = useMessage()
const auth = useAuthStore()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const saving = ref(false)

const registrationEnabled = ref(false)
const togglingRegistration = ref(false)

onMounted(async () => {
  try {
    const { data } = await api.get('/admin/settings')
    registrationEnabled.value = !!data.registrationEnabled
  } catch (e) {
    message.error(errMsg(e, '加载设置失败'))
  }
})

async function toggleRegistration(value: boolean) {
  togglingRegistration.value = true
  try {
    const { data } = await api.patch('/admin/settings', { registrationEnabled: value })
    registrationEnabled.value = !!data.registrationEnabled
    message.success(value ? '已开放注册' : '已关闭注册')
  } catch (e) {
    registrationEnabled.value = !value
    message.error(errMsg(e, '操作失败'))
  } finally {
    togglingRegistration.value = false
  }
}

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

    <n-card class="settings-card surface-card" title="用户注册" :bordered="false">
      <div class="setting-row">
        <div>
          <strong>开放用户自助注册</strong>
          <p class="setting-hint">关闭后，登录页不显示注册入口，仅管理员邀请可创建用户。</p>
        </div>
        <n-switch
          :value="registrationEnabled"
          :loading="togglingRegistration"
          @update:value="toggleRegistration"
        />
      </div>
    </n-card>
  </div>
</template>

<style scoped>
.settings-card {
  max-width: 520px;
}

.settings-card + .settings-card {
  margin-top: 18px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.setting-hint {
  margin: 6px 0 0;
  color: rgba(15, 23, 42, 0.52);
  font-size: 13px;
}
</style>
