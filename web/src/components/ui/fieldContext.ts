import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'

export interface FieldContext {
  id: string
  labelId: string
  invalid: ComputedRef<boolean>
  descriptionId: ComputedRef<string | undefined>
}

const fieldContextKey: InjectionKey<FieldContext> = Symbol('ui-field-context')
let fieldId = 0

export function provideFieldContext(explicitId?: string, feedback: () => { error?: string; hint?: string } = () => ({})): FieldContext {
  const id = explicitId || `ui-field-${++fieldId}`
  const context: FieldContext = { id, labelId: `${id}-label`, invalid: computed(() => !!feedback().error),
    descriptionId: computed(() => feedback().error ? `${id}-error` : feedback().hint ? `${id}-hint` : undefined) }
  provide(fieldContextKey, context)
  return context
}

export function useFieldContext(): FieldContext | undefined {
  return inject(fieldContextKey, undefined)
}
