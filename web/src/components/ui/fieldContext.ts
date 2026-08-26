import { inject, provide, type InjectionKey } from 'vue'

export interface FieldContext {
  id: string
  labelId: string
}

const fieldContextKey: InjectionKey<FieldContext> = Symbol('ui-field-context')
let fieldId = 0

export function provideFieldContext(explicitId?: string): FieldContext {
  const id = explicitId || `ui-field-${++fieldId}`
  const context: FieldContext = { id, labelId: `${id}-label` }
  provide(fieldContextKey, context)
  return context
}

export function useFieldContext(): FieldContext | undefined {
  return inject(fieldContextKey, undefined)
}
