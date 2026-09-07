interface FunctionItem {
  type?: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
}

interface ToolEvent {
  type?: string
  item_id?: string
  output_index?: number
  delta?: string
  arguments?: string
  item?: FunctionItem
  response?: { output?: FunctionItem[] }
}

interface TrackedCall {
  index: number
  item: FunctionItem
  arguments: string
  emitted: string
  announced: boolean
}

/** Reconciles incremental arguments with authoritative done/terminal payloads. */
export function createFunctionCallTracker() {
  const calls: TrackedCall[] = []
  const byId = new Map<string, TrackedCall>()
  const byCallId = new Map<string, TrackedCall>()
  const byOutput = new Map<number, TrackedCall>()

  function note(event: ToolEvent): Record<string, unknown>[] {
    const item = event.item
    const id = item?.id ?? event.item_id
    const outputIndex = event.output_index
    let call = (id ? byId.get(id) : undefined)
      ?? (item?.call_id ? byCallId.get(item.call_id) : undefined)
      ?? (outputIndex != null ? byOutput.get(outputIndex) : undefined)
    if (!call) {
      if (item?.type !== 'function_call' && !id && outputIndex == null) return []
      call = { index: calls.length, item: {}, arguments: '', emitted: '', announced: false }
      calls.push(call)
    }
    if (id) byId.set(id, call)
    if (item?.call_id) byCallId.set(item.call_id, call)
    if (outputIndex != null) byOutput.set(outputIndex, call)
    if (item) {
      call.item = { ...call.item, ...item }
      // Empty terminal fields must not erase arguments assembled earlier.
      if (typeof item.arguments === 'string' && item.arguments) call.arguments = item.arguments
    }
    if (event.type === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
      call.arguments += event.delta
    }
    if (event.type === 'response.function_call_arguments.done' && typeof event.arguments === 'string') {
      call.arguments = event.arguments
    }
    if (!call.item.name) return []
    if (!call.announced) {
      call.announced = true
      call.emitted = call.arguments
      return [{ index: call.index, id: call.item.call_id ?? call.item.id ?? `call_${call.index}`,
        type: 'function', function: { name: call.item.name, arguments: call.arguments } }]
    }
    // Done events repeat the full JSON. Only send bytes the client has not
    // received; appending the whole payload would corrupt its assembled JSON.
    if (!call.arguments.startsWith(call.emitted)) return []
    const suffix = call.arguments.slice(call.emitted.length)
    call.emitted = call.arguments
    return suffix ? [{ index: call.index, function: { arguments: suffix } }] : []
  }

  return {
    feed(raw: unknown): Record<string, unknown>[] {
      const event = raw as ToolEvent | null
      if (!event) return []
      if (event.item?.type === 'function_call') return note(event)
      if (event.type === 'response.function_call_arguments.delta' || event.type === 'response.function_call_arguments.done') {
        return note(event)
      }
      if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        return (event.response?.output ?? []).flatMap((item, output_index) =>
          item.type === 'function_call' ? note({ item, output_index }) : [],
        )
      }
      return []
    },
    output(): FunctionItem[] {
      return calls.filter(call => call.item.name).map(call => ({ ...call.item, arguments: call.arguments }))
    },
  }
}
