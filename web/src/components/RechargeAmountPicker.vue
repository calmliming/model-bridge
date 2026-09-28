<script setup lang="ts">
import { RECHARGE_PRESETS } from '../billing'
defineProps<{ modelValue: number }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: number): void }>()
</script>

<template>
  <fieldset class="recharge-presets">
    <legend>选择到账额度</legend>
    <div class="recharge-options">
      <label v-for="amount in RECHARGE_PRESETS" :key="amount" :class="{ selected: modelValue === amount }">
        <input type="radio" name="recharge-preset" :value="amount" :checked="modelValue === amount" @change="emit('update:modelValue', amount)" />
        <strong>${{ amount }}</strong><span>USD 额度</span>
      </label>
    </div>
    <p>一次充值，按实际调用用量扣费；也可在下方输入自定义金额。</p>
  </fieldset>
</template>

<style scoped>
legend { font-size: 13px; font-weight: 500; margin-bottom: 10px; }
.recharge-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
label { display: flex; position: relative; flex-direction: column; gap: 3px; padding: 14px 12px; border: 1px solid #dce5e3; background: #fff; border-radius: 10px; cursor: pointer; transition: background .2s, border-color .2s; }
label:hover { border-color: #599f93; }
label.selected { border-color: #0d9488; background: #effaf6; }
input { position: absolute; opacity: 0; width: 1px; height: 1px; }
label:focus-within { outline: 2px solid #0d9488; outline-offset: 3px; }
strong { font-size: 21px; font-weight: 600; font-variant-numeric: tabular-nums; }
span, p { font-size: 11px; color: #6c8179; }
p { margin: 12px 0 20px; line-height: 1.8; }
:global(.dark) label { border-color: #3a504a; background: #162b29; }
:global(.dark) label.selected { border-color: #55b7a6; background: #1b3932; }
:global(.dark) span, :global(.dark) p { color: #a7bfb6; }
@media (max-width: 360px) { .recharge-options { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (prefers-reduced-motion: reduce) { label { transition: none; } }
</style>
