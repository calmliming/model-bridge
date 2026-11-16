<script setup lang="ts">
import { UiDatePicker, UiFormItem, UiInputNumber } from './ui'

const quotaLimit = defineModel<number | null>('quotaLimit', { required: true })
const rateLimit = defineModel<number | null>('rateLimit', { required: true })
const concurrencyLimit = defineModel<number | null>('concurrencyLimit', { required: true })
const expiresAt = defineModel<number | null>('expiresAt', { required: true })
</script>

<template>
  <details class="group rounded-xl border border-gray-200 dark:border-dark-600">
    <summary class="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-primary-500 dark:text-gray-200 dark:hover:bg-dark-700 [&::-webkit-details-marker]:hidden">
      高级设置
      <svg aria-hidden="true" class="h-4 w-4 text-gray-500 group-open:rotate-180 dark:text-dark-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="m4 6 4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </summary>
    <div class="border-t border-gray-200 p-3.5 dark:border-dark-600">
      <div class="grid gap-3 min-[500px]:grid-cols-2">
        <UiFormItem label="成本上限（USD）" class="!mb-0 min-w-0">
          <UiInputNumber v-model:value="quotaLimit" :min="0" :step="1" />
        </UiFormItem>
        <UiFormItem label="速率上限（次/分钟）" class="!mb-0 min-w-0">
          <UiInputNumber v-model:value="rateLimit" :min="1" :step="10" />
        </UiFormItem>
        <UiFormItem label="并发上限" class="!mb-0 min-w-0">
          <UiInputNumber v-model:value="concurrencyLimit" :min="1" :step="1" />
        </UiFormItem>
        <UiFormItem label="过期时间" class="!mb-0 min-w-0">
          <UiDatePicker v-model:value="expiresAt" type="datetime" clearable />
        </UiFormItem>
      </div>
      <p class="field-hint mt-2">上限留空为不限，过期时间留空为永久。</p>
    </div>
  </details>
</template>
