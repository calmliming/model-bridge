<script setup lang="ts">
import { dialogState, confirm, cancel } from '../../composables/useDialog'

const accent: Record<string, { icon: string; ring: string; confirm: string }> = {
  warning: { icon: 'text-amber-500 bg-amber-100 dark:bg-amber-900/30', ring: '', confirm: 'btn-danger' },
  error: { icon: 'text-red-500 bg-red-100 dark:bg-red-900/30', ring: '', confirm: 'btn-danger' },
  info: { icon: 'text-primary-500 bg-primary-100 dark:bg-primary-900/30', ring: '', confirm: 'btn-primary' },
  success: { icon: 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30', ring: '', confirm: 'btn-success' },
}
</script>

<template>
  <Teleport to="body">
    <div
      v-for="d in dialogState.dialogs"
      :key="d.id"
      class="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      @click.self="cancel(d.id)"
    >
      <div class="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-dark-800">
        <div class="flex items-start gap-3 px-6 pt-6">
          <span
            class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
            :class="accent[d.type ?? 'warning'].icon"
          >
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          </span>
          <div class="min-w-0 flex-1 pt-0.5">
            <h3 v-if="d.title" class="text-base font-semibold text-gray-900 dark:text-white">
              {{ d.title }}
            </h3>
            <component :is="d.content" v-if="typeof d.content === 'function'" class="mt-2" />
            <p v-else class="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              {{ d.content }}
            </p>
          </div>
        </div>
        <div class="flex justify-end gap-3 px-6 pb-5 pt-5">
          <button v-if="d.negativeText" class="btn btn-secondary btn-sm" @click="cancel(d.id)">
            {{ d.negativeText }}
          </button>
          <button
            class="btn btn-sm"
            :class="accent[d.type ?? 'warning'].confirm"
            :disabled="d.loading"
            @click="confirm(d.id)"
          >
            <span v-if="d.loading" class="spinner h-3.5 w-3.5" />
            {{ d.positiveText ?? '确定' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
