<script setup lang="ts">
import { computed } from 'vue'
import type { BillingPlan } from '../billing'
import { formatUsageQuota } from '../billing'

const props = defineProps<{ plan: BillingPlan }>()
const recommended = computed(() => props.plan.name.toLowerCase() === 'pro')
const tierLabel = computed(() => ({ lite: '轻量使用', pro: '日常主力', max: '高频进阶' }[props.plan.name.toLowerCase()] ?? '自选套餐'))
const money = (value: number | null) => value == null ? '不限' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const quota = computed(() => {
  const plan = props.plan
  return plan.quotaMode === 'usage'
    ? {
        label: '每月额度',
        value: formatUsageQuota(plan.monthlyLimitPoints),
        note: '按模型价目表计算，各 Key 共享',
        windows: [{ label: '每 5 小时', value: formatUsageQuota(plan.fiveHourLimitPoints) }, { label: '每周', value: formatUsageQuota(plan.weeklyLimitPoints) }]
      }
    : {
        label: '每 30 天额度',
        value: money(plan.monthlyLimitUsd),
        note: '按实际调用费用扣减',
        windows: [{ label: '每日', value: money(plan.dailyLimitUsd) }, { label: '每周', value: money(plan.weeklyLimitUsd) }]
      }
})
</script>

<template>
  <article class="plan-card" :class="{ 'plan-card--recommended': recommended }" :aria-label="`${plan.name} 套餐`">
    <div class="plan-card-top">
      <span class="plan-tier-label">{{ tierLabel }}</span>
      <span v-if="recommended" class="plan-recommended">推荐</span>
      <slot name="selection" />
    </div>
    <h2>{{ plan.name }}</h2>
    <p class="plan-description">{{ plan.description || '灵活的模型调用额度，满足你的使用需求。' }}</p>
    <div class="plan-price"><strong>{{ money(plan.price) }}</strong><span>/ {{ plan.paymentProvider === 'waffo' ? '月' : `${plan.validityDays} 天` }}</span></div>
    <p class="plan-billing-note">{{ plan.paymentProvider === 'waffo' ? 'Waffo 按月订阅' : '钱包余额一次性购买' }}</p>
    <dl class="plan-quota">
      <div class="plan-quota-main">
        <dt>{{ quota.label }}</dt>
        <dd class="plan-quota-value">{{ quota.value }}</dd>
        <dd class="plan-quota-note">{{ quota.note }}</dd>
      </div>
      <div class="plan-quota-windows">
        <div v-for="window in quota.windows" :key="window.label"><dt>{{ window.label }}</dt><dd>{{ window.value }}</dd></div>
      </div>
    </dl>
    <p v-if="plan.quotaMode === 'usage'" class="plan-policy">按所选模型与实际输入、输出、缓存用量扣减额度，三项上限同时生效。同样的任务，模型和缓存命中情况会影响消耗。</p>
    <details v-if="plan.quotaMode === 'usage' && plan.usageProfile === 'opencode-go' && plan.usageBands?.length" class="model-allowances">
      <summary>不同模型能用多少</summary>
      <div v-for="band in plan.usageBands" :key="band.multiplier" class="model-allowance">
        <div class="model-allowance-head"><strong>{{ band.label }}</strong><span>每月约 {{ money(band.monthlyReferenceUsd) }}</span></div>
        <p>{{ band.examples }}</p>
      </div>
      <p class="model-allowance-foot">各模型共享上方额度，不能叠加。未列模型按 4 倍消耗，实际可用模型以分组为准。</p>
    </details>
    <p v-if="plan.groupName" class="plan-group"><span class="plan-group-dot" />{{ plan.groupName }}</p>
    <div class="plan-card-actions"><slot /></div>
    <slot name="status" />
  </article>
</template>

<style scoped>
.plan-card { display: flex; flex-direction: column; min-width: 0; padding: 25px; border: 1px solid #e2e8e8; border-radius: 18px; background: #fff; color: #172b2a; transition: border-color .2s, box-shadow .2s; }
.plan-card:hover { border-color: #94b8b2; box-shadow: 0 7px 24px #143e3410; }
.plan-card--recommended { border-color: #55ada0; background: #f5fcfa; }
.plan-card-top { display: flex; align-items: center; gap: 10px; min-height: 24px; margin-bottom: 16px; }
.plan-tier-label { font-size: 12px; color: #617875; flex: 1; }
.plan-recommended { color: #0f766e; background: #dff5ee; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 5px; }
h2 { font-size: 25px; font-weight: 650; letter-spacing: -.7px; line-height: 1.2; overflow-wrap: anywhere; }
.plan-description { color: #657975; font-size: 13px; line-height: 1.8; min-height: 47px; margin: 12px 0 20px; overflow-wrap: anywhere; }
.plan-price { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px; font-variant-numeric: tabular-nums; }
.plan-price strong { font-size: 38px; font-weight: 650; letter-spacing: -1.6px; line-height: 1.2; overflow-wrap: anywhere; }
.plan-price span, .plan-billing-note { color: #657975; font-size: 12px; }
.plan-billing-note { margin: 8px 0 22px; }
.plan-quota { border: 1px solid #dde8e4; border-radius: 14px; background: #f7faf9; overflow: hidden; }
.plan-quota-main { display: grid; gap: 3px; padding: 15px 17px 14px; }
.plan-quota dt { color: #657975; font-size: 12px; }
.plan-quota-value { color: #0f766e; font-size: 28px; font-weight: 650; letter-spacing: -.8px; line-height: 1.25; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.plan-quota-note { color: #7a8d89; font-size: 11px; line-height: 1.6; }
.plan-quota-windows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid #dde8e4; }
.plan-quota-windows div { display: grid; gap: 2px; min-width: 0; padding: 11px 17px 12px; }
.plan-quota-windows div + div { border-left: 1px solid #dde8e4; }
.plan-quota-windows dt { font-size: 11px; }
.plan-quota-windows dd { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.plan-card--recommended .plan-quota { background: #fff; border-color: #c4e4da; }
.plan-group { display: flex; align-items: baseline; gap: 7px; margin: 22px 0 0; font-size: 12px; color: #657975; overflow-wrap: anywhere; }
.plan-policy { color: #657975; font-size: 11px; line-height: 1.7; margin-top: 14px; }
.model-allowances { margin-top: 12px; font-size: 11px; line-height: 1.7; color: #657975; }
.model-allowances summary { cursor: pointer; color: #0f766e; font-size: 12px; }
.model-allowance { display: grid; gap: 2px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #dde8e4; }
.model-allowance:first-of-type { border-top: 0; padding-top: 0; }
.model-allowance-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.model-allowance-head strong { font-weight: 600; color: #244b3e; }
.model-allowance-head span { color: #0f766e; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.model-allowance-foot { margin-top: 12px; }
.plan-group-dot { height: 5px; width: 5px; border-radius: 50%; background: #71a79b; flex-shrink: 0; }
.plan-card-actions { padding-top: 24px; margin-top: auto; }
.dark .plan-card { background: #15282a; color: #e4f0ed; border-color: #304647; }
.dark .plan-card--recommended { background: #18332f; border-color: #408f7f; }
.dark .plan-description, .dark .plan-tier-label, .dark .plan-billing-note, .dark .plan-price span, .dark .plan-quota dt, .dark .plan-quota-note, .dark .plan-group { color: #aac1bb; }
.dark .plan-quota, .dark .plan-card--recommended .plan-quota { background: #1a3133; border-color: #354d47; }
.dark .plan-quota-windows, .dark .plan-quota-windows div + div, .dark .model-allowance { border-color: #354d47; }
.dark .plan-quota-value, .dark .model-allowance-head span { color: #79d0b8; }
.dark .plan-policy, .dark .model-allowances { color: #aac1bb; }
.dark .model-allowances summary, .dark .model-allowance-head strong { color: #79d0b8; }
.dark .plan-recommended { background: #244e41; color: #98ddc7; }
@media (max-width: 480px) { .plan-card { padding: 22px; } .plan-description { min-height: 0; } .plan-quota-main { padding: 14px 15px 13px; } .plan-quota-windows div { padding: 10px 15px 11px; } }
@media (prefers-reduced-motion: reduce) { .plan-card { transition: none; } }
</style>
