import type { App } from 'vue'
import UiButton from './UiButton.vue'
import UiCard from './UiCard.vue'
import UiModal from './UiModal.vue'
import UiInput from './UiInput.vue'
import UiInputNumber from './UiInputNumber.vue'
import UiSwitch from './UiSwitch.vue'
import UiTag from './UiTag.vue'
import UiAlert from './UiAlert.vue'
import UiFormItem from './UiFormItem.vue'
import UiForm from './UiForm.vue'
import UiSelect from './UiSelect.vue'
import UiDataTable from './UiDataTable.vue'
import UiTabs from './UiTabs.vue'
import UiTabPane from './UiTabPane.vue'
import UiTooltip from './UiTooltip.vue'
import UiRadioGroup from './UiRadioGroup.vue'
import UiRadioButton from './UiRadioButton.vue'
import UiRadio from './UiRadio.vue'
import UiSteps from './UiSteps.vue'
import UiStep from './UiStep.vue'
import UiDatePicker from './UiDatePicker.vue'
import UiSpin from './UiSpin.vue'
import UiText from './UiText.vue'
import UiSpace from './UiSpace.vue'
import UiCheckbox from './UiCheckbox.vue'
import UiDivider from './UiDivider.vue'
import UiGrid from './UiGrid.vue'
import UiGi from './UiGi.vue'
import UiPagination from './UiPagination.vue'

/**
 * Registers the Tailwind-based UI kit under the legacy `n-*` tag names so existing
 * view templates keep working during the Naive UI → Tailwind migration. Render
 * functions (h(NButton, ...)) import the `Ui*` components directly instead.
 */
export function installUi(app: App): void {
  app.component('n-button', UiButton)
  app.component('n-card', UiCard)
  app.component('n-modal', UiModal)
  app.component('n-input', UiInput)
  app.component('n-input-number', UiInputNumber)
  app.component('n-switch', UiSwitch)
  app.component('n-tag', UiTag)
  app.component('n-alert', UiAlert)
  app.component('n-form-item', UiFormItem)
  app.component('n-form', UiForm)
  app.component('n-select', UiSelect)
  app.component('n-data-table', UiDataTable)
  app.component('n-tabs', UiTabs)
  app.component('n-tab-pane', UiTabPane)
  app.component('n-tooltip', UiTooltip)
  app.component('n-radio-group', UiRadioGroup)
  app.component('n-radio-button', UiRadioButton)
  app.component('n-radio', UiRadio)
  app.component('n-steps', UiSteps)
  app.component('n-step', UiStep)
  app.component('n-date-picker', UiDatePicker)
  app.component('n-spin', UiSpin)
  app.component('n-text', UiText)
  app.component('n-space', UiSpace)
  app.component('n-checkbox', UiCheckbox)
  app.component('n-divider', UiDivider)
  app.component('n-grid', UiGrid)
  app.component('n-gi', UiGi)
  app.component('n-pagination', UiPagination)
}

export {
  UiButton,
  UiCard,
  UiModal,
  UiInput,
  UiInputNumber,
  UiSwitch,
  UiTag,
  UiAlert,
  UiFormItem,
  UiForm,
  UiSelect,
  UiDataTable,
  UiTabs,
  UiTabPane,
  UiTooltip,
  UiRadioGroup,
  UiRadioButton,
  UiRadio,
  UiSteps,
  UiStep,
  UiDatePicker,
  UiSpin,
  UiText,
  UiSpace,
  UiCheckbox,
  UiDivider,
  UiGrid,
  UiGi,
  UiPagination,
}
