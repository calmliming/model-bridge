<script setup lang="ts">
import { provideFieldContext } from './fieldContext'

const props = defineProps<{ label?: string; hint?: string; error?: string; forId?: string }>()
const field = provideFieldContext(props.forId)
</script>

<template>
  <div class="mb-4 last:mb-0">
    <label v-if="props.label" :id="field.labelId" class="field-label" :for="field.id">{{ props.label }}</label>
    <slot />
    <p v-if="props.error" class="field-error">{{ props.error }}</p>
    <p v-else-if="props.hint" class="field-hint">{{ props.hint }}</p>
  </div>
</template>
