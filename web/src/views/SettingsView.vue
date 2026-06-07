<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMessage } from '../composables/useMessage'
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
  <div class="space-y-5">
    <UiCard class="max-w-xl" title="管理员账户">
      <UiForm label-placement="top">
        <UiFormItem label="当前用户">
          <UiInput :value="auth.username ?? ''" readonly />
        </UiFormItem>
        <UiFormItem label="当前密码">
          <UiInput v-model:value="currentPassword" type="password" />
        </UiFormItem>
        <UiFormItem label="新密码">
          <UiInput v-model:value="newPassword" type="password" />
        </UiFormItem>
        <UiFormItem label="确认新密码">
          <UiInput
            v-model:value="confirmPassword"
            type="password"
            @keyup.enter="changePassword"
          />
        </UiFormItem>
        <UiButton type="primary" :loading="saving" @click="changePassword">更新密码</UiButton>
      </UiForm>
    </UiCard>

    <UiCard class="max-w-xl" title="用户注册">
      <div class="flex items-center justify-between gap-5">
        <div>
          <strong class="text-gray-900 dark:text-white">开放用户自助注册</strong>
          <p class="mt-1.5 text-[13px] text-gray-500 dark:text-dark-400">
            关闭后，登录页不显示注册入口，仅管理员邀请可创建用户。
          </p>
        </div>
        <UiSwitch
          :value="registrationEnabled"
          @update:value="toggleRegistration"
        />
      </div>
    </UiCard>
  </div>
</template>
