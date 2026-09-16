import { computed, ref, type Ref } from 'vue'
import { errMsg } from '../api/client'

/** Per-row outcome of a batch run. */
export interface BatchOutcome {
  id: string | number
  ok: boolean
  error?: string
}

export interface BatchSummary {
  success: number
  failed: number
  /** First failure reason, for the toast — the rest are in `results`. */
  firstError?: string
}

interface Options {
  /** Requests in flight at once. Serial awaits made a 200-row batch take
   *  minutes and hold the whole toolbar disabled for the duration. */
  concurrency?: number
  /** Per-request timeout. The shared axios instance sets none, so without this
   *  a single stalled response never settles and the batch never finishes. */
  timeoutMs?: number
}

/**
 * Selection state and batch execution shared by the table views.
 *
 * Previously each view carried its own copy of this, and they drifted: the keys
 * page counted every HTTP 200 as success and dropped the whole selection on a
 * partial failure, while the accounts page kept the failures selected for a
 * retry. This keeps the accounts-page behaviour everywhere.
 */
export function useBulkSelection<T>(rows: Ref<T[]>, keyOf: (row: T) => string | number, options: Options = {}) {
  const { concurrency = 5, timeoutMs = 20_000 } = options

  const selectedIds = ref<Array<string | number>>([])
  const busy = ref(false)
  const selectedCount = computed(() => selectedIds.value.length)

  /** Drops selected ids whose row is no longer present (deleted / filtered out). */
  function prune() {
    const alive = new Set(rows.value.map(keyOf))
    selectedIds.value = selectedIds.value.filter((id) => alive.has(id))
  }

  function clear() {
    selectedIds.value = []
  }

  /** Keeps only the rows that failed, so a partial failure can be retried
   *  without re-finding them by hand. */
  function retainFailures(results: BatchOutcome[]) {
    const failed = new Set(results.filter((result) => !result.ok).map((result) => result.id))
    selectedIds.value = selectedIds.value.filter((id) => failed.has(id))
  }

  /** Row checkboxes stay clickable during a batch unless the view opts in:
   *  unchecking a queued row reads as a cancel but the snapshot still runs, and
   *  a row checked mid-batch is silently skipped. */
  function rowCheckable() {
    return !busy.value
  }

  /**
   * Runs `run` for every id with bounded concurrency, collecting a per-row
   * outcome instead of a bare count so failures can be reported and retried.
   */
  async function runBatch(ids: Array<string | number>, run: (id: string | number, timeoutMs: number) => Promise<unknown>): Promise<BatchOutcome[]> {
    const queue = [...ids]
    const results: BatchOutcome[] = []
    const worker = async () => {
      for (;;) {
        const id = queue.shift()
        if (id === undefined) return
        try {
          await run(id, timeoutMs)
          results.push({ id, ok: true })
        } catch (e) {
          results.push({ id, ok: false, error: errMsg(e) })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
    return results
  }

  return { selectedIds, busy, selectedCount, prune, clear, retainFailures, rowCheckable, runBatch, summarizeBatch }
}

export function summarizeBatch(results: BatchOutcome[]): BatchSummary {
  const failures = results.filter((result) => !result.ok)
  return {
    success: results.length - failures.length,
    failed: failures.length,
    firstError: failures[0]?.error,
  }
}
