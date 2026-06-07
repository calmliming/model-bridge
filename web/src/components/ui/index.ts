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

export function installUi(app: App): void {
  app.component('UiButton', UiButton)
  app.component('UiCard', UiCard)
  app.component('UiModal', UiModal)
  app.component('UiInput', UiInput)
  app.component('UiInputNumber', UiInputNumber)
  app.component('UiSwitch', UiSwitch)
  app.component('UiTag', UiTag)
  app.component('UiAlert', UiAlert)
  app.component('UiFormItem', UiFormItem)
  app.component('UiForm', UiForm)
  app.component('UiSelect', UiSelect)
  app.component('UiDataTable', UiDataTable)
  app.component('UiTabs', UiTabs)
  app.component('UiTabPane', UiTabPane)
  app.component('UiTooltip', UiTooltip)
  app.component('UiRadioGroup', UiRadioGroup)
  app.component('UiRadioButton', UiRadioButton)
  app.component('UiRadio', UiRadio)
  app.component('UiSteps', UiSteps)
  app.component('UiStep', UiStep)
  app.component('UiDatePicker', UiDatePicker)
  app.component('UiSpin', UiSpin)
  app.component('UiText', UiText)
  app.component('UiSpace', UiSpace)
  app.component('UiCheckbox', UiCheckbox)
  app.component('UiDivider', UiDivider)
  app.component('UiGrid', UiGrid)
  app.component('UiGi', UiGi)
  app.component('UiPagination', UiPagination)
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
