<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import SubscriptionPlanCard from '../components/SubscriptionPlanCard.vue'
import { useDialog } from '../composables/useDialog'
import { useMessage } from '../composables/useMessage'
import { api, errMsg } from '../api/client'
import { usagePointsToUsd, usdToUsagePoints } from '../billing'
import { useBulkSelection, summarizeBatch, type BatchOutcome } from '../composables/useBulkSelection'

interface Plan {
  id: string
  name: string
  description: string | null
  groupId: string
  groupName: string | null
  price: number
  dailyLimitUsd: number | null
  weeklyLimitUsd: number | null
  monthlyLimitUsd: number | null
  validityDays: number
  forSale: boolean
  sortOrder: number
  paymentProvider: 'wallet' | 'waffo'
  waffoProductId: string | null
  hasAccounts: boolean
  quotaMode: 'spend' | 'usage'
  usageProfile?: 'base' | 'opencode-go'
  fiveHourLimitPoints: number | null
  weeklyLimitPoints: number | null
  monthlyLimitPoints: number | null
}

interface GroupOption {
  id: string
  name: string
}

const message = useMessage()
const dialog = useDialog()
const loading = ref(false)
const loadError = ref('')
const waffo = ref<{ configured: boolean; mode: string; missing: string[] } | null>(null)
const plans = ref<Plan[]>([])
const groups = ref<GroupOption[]>([])
const groupOptions = computed(() => groups.value.map((g) => ({ label: g.name, value: g.id })))

const showEdit = ref(false)
const saving = ref(false)
const editing = ref<Plan | null>(null)
const form = ref({
  name: '',
  description: '',
  groupId: null as string | null,
  price: 0,
  dailyLimitUsd: null as number | null,
  weeklyLimitUsd: null as number | null,
  monthlyLimitUsd: null as number | null,
  validityDays: 30,
  forSale: false,
  paymentProvider: 'waffo' as 'wallet' | 'waffo',
  waffoProductId: '',
  quotaMode: 'usage' as 'spend' | 'usage',
  usageProfile: 'opencode-go' as 'base' | 'opencode-go',
  fiveHourQuotaUsd: 12 as number | null,
  weeklyQuotaUsd: 30 as number | null,
  monthlyQuotaUsd: 60 as number | null
})

const pointsToUsd = (points: number | null) => points == null ? null : usagePointsToUsd(points)
const usdToPoints = (usd: number | null) => usd == null ? null : usdToUsagePoints(usd)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    // Bound both requests: batch completion waits here before releasing bulkBusy.
    const [planRes, groupRes] = await Promise.all([
      api.get('/admin/subscription-plans', { timeout: 20_000 }),
      api.get('/admin/account-groups', { timeout: 20_000 })
    ])
    plans.value = planRes.data.plans
    waffo.value = planRes.data.waffo
    pruneSelectedPlans()
    groups.value = groupRes.data.groups
  } catch (e) {
    loadError.value = errMsg(e, '套餐加载失败，请重试')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.value = {
    name: '',
    description: '',
    groupId: groups.value[0]?.id ?? null,
    price: 0,
    dailyLimitUsd: null,
    weeklyLimitUsd: null,
    monthlyLimitUsd: null,
    validityDays: 30,
    forSale: false,
    paymentProvider: 'waffo',
    waffoProductId: '',
    quotaMode: 'usage',
    usageProfile: 'opencode-go',
    fiveHourQuotaUsd: 12,
    weeklyQuotaUsd: 30,
    monthlyQuotaUsd: 60
  }
  showEdit.value = true
}

function openEdit(plan: Plan) {
  editing.value = plan
  form.value = {
    name: plan.name,
    description: plan.description ?? '',
    groupId: plan.groupId,
    price: plan.price,
    dailyLimitUsd: plan.dailyLimitUsd,
    weeklyLimitUsd: plan.weeklyLimitUsd,
    monthlyLimitUsd: plan.monthlyLimitUsd,
    validityDays: plan.validityDays,
    forSale: plan.forSale,
    paymentProvider: plan.paymentProvider,
    waffoProductId: plan.waffoProductId ?? '',
    quotaMode: plan.quotaMode,
    usageProfile: plan.usageProfile ?? 'base',
    fiveHourQuotaUsd: pointsToUsd(plan.fiveHourLimitPoints),
    weeklyQuotaUsd: pointsToUsd(plan.weeklyLimitPoints),
    monthlyQuotaUsd: pointsToUsd(plan.monthlyLimitPoints)
  }
  showEdit.value = true
}

async function save() {
  if (!form.value.name.trim()) {
    message.warning('请填写套餐名称')
    return
  }
  if (!form.value.groupId) {
    message.warning('请选择绑定的账号分组')
    return
  }
  if (form.value.paymentProvider === 'waffo' && (!Number.isFinite(form.value.price) || form.value.price <= 0)) {
    message.warning('Waffo 月费必须大于 0')
    return
  }
  if (form.value.quotaMode === 'usage' && [form.value.fiveHourQuotaUsd, form.value.weeklyQuotaUsd, form.value.monthlyQuotaUsd].some(value => value == null || !Number.isFinite(value) || usdToUsagePoints(value) <= 0)) {
    message.warning('请填写不低于 $0.01 的 5 小时、每周和每月额度')
    return
  }
  saving.value = true
  const payload = {
    name: form.value.name.trim(),
    description: form.value.description.trim() || null,
    groupId: form.value.groupId,
    price: form.value.price,
    dailyLimitUsd: form.value.dailyLimitUsd,
    weeklyLimitUsd: form.value.weeklyLimitUsd,
    monthlyLimitUsd: form.value.monthlyLimitUsd,
    validityDays: form.value.validityDays,
    forSale: form.value.forSale,
    paymentProvider: form.value.paymentProvider,
    waffoProductId: form.value.waffoProductId.trim() || null,
    quotaMode: form.value.quotaMode,
    usageProfile: form.value.usageProfile,
    fiveHourLimitPoints: usdToPoints(form.value.fiveHourQuotaUsd),
    weeklyLimitPoints: usdToPoints(form.value.weeklyQuotaUsd),
    monthlyLimitPoints: usdToPoints(form.value.monthlyQuotaUsd)
  }
  try {
    if (editing.value) {
      await api.patch(`/admin/subscription-plans/${editing.value.id}`, payload)
    } else {
      await api.post('/admin/subscription-plans', payload)
    }
    showEdit.value = false
    message.success('已保存')
    await load()
  } catch (e) {
    message.error(errMsg(e, '保存失败'))
  } finally {
    saving.value = false
  }
}

function confirmDelete(plan: Plan) {
  dialog.warning({
    title: '删除套餐',
    content: `确定删除套餐「${plan.name}」？已生效订阅会因套餐缺失而改走余额扣费，建议先改为下架。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.delete(`/admin/subscription-plans/${plan.id}`)
        message.success('已删除')
        await load()
      } catch (e) {
        message.error(errMsg(e, '删除失败'))
      }
    }
  })
}

function planRowKey(row: Plan) {
  return row.id
}

const {
  selectedIds: selectedPlanIds,
  busy: bulkBusy,
  selectedCount: selectedPlanCount,
  prune: pruneSelectedPlans,
  retainFailures: retainFailedPlans,
  runBatch
} = useBulkSelection(plans, planRowKey)

function selectPlan(id: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedPlanIds.value = checked ? [...new Set([...selectedPlanIds.value, id])] : selectedPlanIds.value.filter(value => value !== id)
}

function notifyBatchResult(action: string, results: BatchOutcome[]) {
  const { success, failed, firstError } = summarizeBatch(results)
  if (failed > 0) {
    message.warning(`${action}完成：成功 ${success} 个，失败 ${failed} 个${firstError ? `（${firstError}）` : ''}。失败项已保留选中，可重试。`)
  } else {
    message.success(`${action}完成：${success} 个套餐`)
  }
}

async function bulkSetForSale(forSale: boolean) {
  if (!selectedPlanCount.value) {
    message.warning('请先选择套餐')
    return
  }
  bulkBusy.value = true
  const action = forSale ? '批量上架' : '批量下架'
  const ids = [...selectedPlanIds.value]
  try {
    const results = await runBatch(ids, (id, timeout) => api.patch(`/admin/subscription-plans/${id}`, { forSale }, { timeout }))
    notifyBatchResult(action, results)
    retainFailedPlans(results)
    await load()
  } finally {
    bulkBusy.value = false
  }
}

function confirmBulkDeletePlans() {
  if (!selectedPlanCount.value) {
    message.warning('请先选择套餐')
    return
  }
  const names = plans.value
    .filter((row) => selectedPlanIds.value.includes(row.id))
    .slice(0, 5)
    .map((row) => `「${row.name}」`)
    .join('、')
  const suffix = selectedPlanCount.value > 5 ? ` 等 ${selectedPlanCount.value} 个套餐` : ''
  dialog.warning({
    title: '批量删除套餐',
    content: `确定删除 ${names}${suffix}？已生效订阅会因套餐缺失而改走余额扣费，建议先改为下架。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      bulkBusy.value = true
      const ids = [...selectedPlanIds.value]
      try {
        const results = await runBatch(ids, (id, timeout) => api.delete(`/admin/subscription-plans/${id}`, { timeout }))
        notifyBatchResult('批量删除', results)
        retainFailedPlans(results)
        await load()
      } finally {
        bulkBusy.value = false
      }
    }
  })
}

onMounted(load)
</script>

<template>
  <div>
    <div class="toolbar">
      <div class="catalog-heading"><h2>为每种用量，准备合适的套餐。</h2><p>按月订阅，额度清晰。价格与服务资源可随时调整。</p></div>
      <div class="toolbar-actions"><UiButton secondary :loading="loading" @click="load">刷新</UiButton><UiButton type="primary" @click="openCreate">新建套餐</UiButton></div>
    </div>
    <UiAlert v-if="loadError" type="error" class="mb-4">{{ loadError }}</UiAlert>
    <div v-if="waffo" class="waffo-status">
      <div><strong>Waffo 订阅支付</strong><span>{{ waffo.configured ? (waffo.mode === 'test' ? '测试模式' : '正式模式') : '待配置' }}</span></div>
      <p v-if="!waffo.configured">在服务端配置商户密钥和通知公钥，再为每档套餐填写 Waffo 月度产品 ID。</p>
      <p v-else>每档套餐关联 Waffo 月度产品；支付成功后自动开通，后续由 Waffo 按月续订。</p>
      <a href="https://pancake.waffo.ai/" target="_blank" rel="noopener noreferrer">打开 Waffo 控制台 ↗</a>
    </div>
    <Transition name="fade">
      <div v-if="selectedPlanCount" class="bulk-actions">
        <div class="bulk-summary">
          <span class="bulk-count">{{ selectedPlanCount }}</span>
          <strong>已选中套餐</strong>
          <UiButton size="tiny" quaternary :disabled="bulkBusy" @click="selectedPlanIds = []">取消选择</UiButton>
        </div>
        <div class="bulk-buttons">
          <UiButton size="small" type="success" secondary :disabled="bulkBusy" @click="bulkSetForSale(true)">上架</UiButton>
          <UiButton size="small" type="warning" secondary :disabled="bulkBusy" @click="bulkSetForSale(false)">下架</UiButton>
          <UiButton size="small" type="error" secondary :disabled="bulkBusy" @click="confirmBulkDeletePlans">删除</UiButton>
        </div>
      </div>
    </Transition>

    <div v-if="loading && !plans.length" class="plan-grid" aria-label="正在加载套餐" aria-busy="true"><div v-for="n in 3" :key="n" class="plan-skeleton" /></div>
    <div v-else-if="plans.length" class="plan-grid">
      <SubscriptionPlanCard v-for="plan in plans" :key="plan.id" :plan="plan">
        <template #selection><input type="checkbox" class="plan-select" :aria-label="`选择 ${plan.name}`" :checked="selectedPlanIds.includes(plan.id)" :disabled="bulkBusy" @change="selectPlan(plan.id, $event)" /></template>
        <div class="plan-actions"><UiButton secondary :disabled="bulkBusy" @click="openEdit(plan)">编辑套餐</UiButton><UiButton quaternary type="error" :disabled="bulkBusy" @click="confirmDelete(plan)">删除</UiButton></div>
        <template #status><div class="plan-status"><UiTag :type="plan.forSale ? 'success' : 'default'" size="small" :bordered="false">{{ plan.forSale ? '已上架' : '未上架' }}</UiTag><span v-if="plan.paymentProvider === 'waffo'">{{ !plan.hasAccounts ? '需分配上游账户' : plan.waffoProductId ? '产品已关联' : '待关联 Waffo 产品' }}</span></div></template>
      </SubscriptionPlanCard>
    </div>
    <div v-else-if="!loadError" class="plans-empty"><h3>还没有套餐</h3><p>创建套餐并绑定账号分组，即可配置订阅额度。</p><UiButton secondary @click="openCreate">新建套餐</UiButton></div>
    <p class="catalog-footnote">加权用量按订阅用户汇总，多个 API Key 共享额度。任一窗口用尽后暂停新调用，等待对应窗口重置。</p>

    <UiModal v-model:show="showEdit" :title="editing ? '编辑套餐' : '新建套餐'" :width="480">
      <UiForm label-placement="top" @submit="save">
        <UiFormItem label="套餐名称">
          <UiInput v-model:value="form.name" placeholder="如：Claude 月卡" />
        </UiFormItem>
        <UiFormItem label="说明（可选）">
          <UiInput v-model:value="form.description" placeholder="给用户看的套餐说明" />
        </UiFormItem>
        <UiFormItem label="绑定账号分组">
          <UiSelect v-model:value="form.groupId" :options="groupOptions" placeholder="订阅授予的调度分组" />
        </UiFormItem>
        <UiFormItem label="购买方式">
          <UiSelect v-model:value="form.paymentProvider" :options="[{ label: 'Waffo 按月订阅', value: 'waffo' }, { label: '钱包余额购买', value: 'wallet' }]" />
        </UiFormItem>
        <UiFormItem v-if="form.paymentProvider === 'waffo'" label="Waffo 月度产品 ID">
          <UiInput v-model:value="form.waffoProductId" placeholder="PROD_…" />
          <p class="field-hint">关联 monthly 产品。下单按当前 USD 月费计价，税费由收银台展示；未关联时用户无法付款。</p>
        </UiFormItem>
        <UiGrid :cols="2" :x-gap="12" :y-gap="2" responsive="screen">
          <UiGi span="2 s:1">
            <UiFormItem :label="form.paymentProvider === 'waffo' ? '月费（USD）' : '售价（USD，0=免费）'">
              <UiInputNumber v-model:value="form.price" :min="form.paymentProvider === 'waffo' ? 0.01 : 0" :precision="2" style="width: 100%" />
            </UiFormItem>
          </UiGi>
          <UiGi span="2 s:1">
            <UiFormItem label="有效期（天）">
              <UiInputNumber v-model:value="form.validityDays" :disabled="form.paymentProvider === 'waffo'" :min="1" :precision="0" style="width: 100%" />
              <p v-if="form.paymentProvider === 'waffo'" class="field-hint">Waffo 以实际月度账期为准。</p>
            </UiFormItem>
          </UiGi>
        </UiGrid>
        <UiFormItem label="用量规则">
          <UiSelect v-model:value="form.quotaMode" :options="[{ label: '加权用量 · 5 小时 / 周 / 月', value: 'usage' }, { label: '金额额度 · 日 / 周 / 30 天（兼容旧套餐）', value: 'spend' }]" />
        </UiFormItem>
        <template v-if="form.quotaMode === 'usage'">
          <UiFormItem label="模型计量规则">
            <UiSelect v-model:value="form.usageProfile" :options="[{ label: '参考 Go · 不同模型按 1 / 2 / 4 倍消耗额度', value: 'opencode-go' }, { label: '统一模型价卡加权（原规则）', value: 'base' }]" />
          </UiFormItem>
          <UiGrid :cols="3" :x-gap="10" :y-gap="2" responsive="screen">
            <UiGi span="3 s:1"><UiFormItem label="5 小时额度（USD）"><UiInputNumber v-model:value="form.fiveHourQuotaUsd" :min="0.01" :step="0.01" /></UiFormItem></UiGi>
            <UiGi span="3 s:1"><UiFormItem label="每周额度（USD）"><UiInputNumber v-model:value="form.weeklyQuotaUsd" :min="0.01" :step="0.01" /></UiFormItem></UiGi>
            <UiGi span="3 s:1"><UiFormItem label="每月额度（USD）"><UiInputNumber v-model:value="form.monthlyQuotaUsd" :min="0.01" :step="0.01" /></UiFormItem></UiGi>
          </UiGrid>
          <p v-if="form.usageProfile === 'opencode-go'" class="field-hint mb-4">以 Go 的 $10 档为参考：5 小时 $12、每周 $30、每月 $60；本站 $30 / $100 档按 3 / 10 倍扩展。标准模型按价目表 1:1 消耗额度，其他模型按 2 / 4 倍消耗；未列模型默认 4 倍。切换规则不会自动修改额度。</p>
          <p v-else class="field-hint mb-4">额度按模型价目表的参考价计算，不是实际采购成本，也不会扣减钱包余额。请结合上游成本、按量售价和实际承载量设置；三项额度同时生效，每月额度按订阅账期重置。</p>
        </template>
        <UiGrid v-else :cols="3" :x-gap="10" :y-gap="2" responsive="screen">
          <UiGi span="3 s:1">
            <UiFormItem label="日限额">
              <UiInputNumber v-model:value="form.dailyLimitUsd" :min="0" placeholder="不限" style="width: 100%" />
            </UiFormItem>
          </UiGi>
          <UiGi span="3 s:1">
            <UiFormItem label="周限额">
              <UiInputNumber v-model:value="form.weeklyLimitUsd" :min="0" placeholder="不限" style="width: 100%" />
            </UiFormItem>
          </UiGi>
          <UiGi span="3 s:1">
            <UiFormItem label="30 天限额">
              <UiInputNumber v-model:value="form.monthlyLimitUsd" :min="0" placeholder="不限" style="width: 100%" />
            </UiFormItem>
          </UiGi>
        </UiGrid>
        <UiFormItem>
          <UiCheckbox v-model:checked="form.forSale">在用户套餐商店上架售卖</UiCheckbox>
        </UiFormItem>
      </UiForm>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showEdit = false">取消</UiButton>
          <UiButton type="primary" :loading="saving" @click="save">保存</UiButton>
        </UiSpace>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 24px;
}
.catalog-heading h2 { font-size: 21px; font-weight: 600; letter-spacing: -.4px; }
.catalog-heading p, .catalog-footnote { color: #72827f; font-size: 12px; margin-top: 8px; line-height: 1.8; }
.toolbar-actions, .plan-actions { display: flex; gap: 10px; }
.plan-actions > :first-child { flex: 1; }
.plan-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 245px), 1fr)); gap: 18px; }
.plan-select { accent-color: #0d9488; width: 16px; height: 16px; cursor: pointer; }
.plan-select:focus-visible { outline: 2px solid #0d9488; outline-offset: 3px; }
.plan-status { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: #72827f; padding-top: 16px; }
.waffo-status { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px; padding: 16px 18px; border: 1px solid #dce8e4; border-radius: 12px; margin-bottom: 22px; background: #f1f7f4; }
.waffo-status strong { font-size: 13px; font-weight: 600; }
.waffo-status span { font-size: 11px; color: #697b75; margin-left: 10px; }
.waffo-status p { font-size: 12px; color: #647970; flex: 1 1 300px; line-height: 1.8; }
.waffo-status a { color: #0f766e; font-size: 12px; text-decoration: underline; text-underline-offset: 3px; }
.catalog-footnote { margin-top: 18px; }
.plans-empty { padding: 70px 24px; text-align: center; }
.plans-empty h3 { font-weight: 600; }
.plans-empty p { margin: 10px 0 20px; color: #72827f; font-size: 13px; }
.plan-skeleton { height: 440px; background: #e9eeec; border-radius: 18px; animation: skeleton-pulse 1.5s ease-in-out infinite; }
:global(.dark) .waffo-status { background: #182f2a; border-color: #354a43; }
:global(.dark) .waffo-status p, :global(.dark) .waffo-status span, :global(.dark) .catalog-heading p, :global(.dark) .catalog-footnote, :global(.dark) .plan-status { color: #a5bab3; }
:global(.dark) .waffo-status a { color: #79d0b8; }
:global(.dark) .plan-skeleton { background: #1d3632; }
@keyframes skeleton-pulse { 50% { opacity: .55; } }
@media (max-width: 600px) { .catalog-heading h2 { font-size: 18px; } .toolbar-actions { width: 100%; justify-content: flex-end; } }
@media (prefers-reduced-motion: reduce) { .plan-skeleton { animation: none; } }
</style>
