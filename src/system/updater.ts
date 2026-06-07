import { config } from '../config'

export type UpdateTaskStatus = 'idle' | 'checking' | 'updating' | 'succeeded' | 'failed'

export interface UpdateCheck {
  currentCommit: string | null
  latestCommit: string | null
  currentVersion: string | null
  latestVersion: string | null
  hasUpdate: boolean
  branch: string
  remote: string
  dirty: boolean
  checkedAt: number
  updaterAvailable: boolean
  warning?: string
}

export interface UpdateTask {
  operationId: string | null
  status: UpdateTaskStatus
  startedAt: number | null
  finishedAt: number | null
  logTail: string
  message?: string | null
  error?: string | null
  currentCommit?: string | null
  latestCommit?: string | null
  currentVersion?: string | null
  latestVersion?: string | null
  updaterAvailable?: boolean
  warning?: string
}

export class UpdaterError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message)
    this.name = 'UpdaterError'
  }
}

function updaterConfigured(): boolean {
  return !!(config.UPDATER_URL && config.UPDATE_TOKEN)
}

function unavailableCheck(warning: string): UpdateCheck {
  return {
    currentCommit: null,
    latestCommit: null,
    currentVersion: null,
    latestVersion: null,
    hasUpdate: false,
    branch: 'main',
    remote: 'origin',
    dirty: false,
    checkedAt: Date.now(),
    updaterAvailable: false,
    warning,
  }
}

function unavailableStatus(warning: string): UpdateTask {
  return {
    operationId: null,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    logTail: '',
    updaterAvailable: false,
    warning,
  }
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function textFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error
  }
  return fallback
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { error: text }
  }
}

async function callUpdater<T>(path: string, init: RequestInit): Promise<T> {
  if (!updaterConfigured()) {
    throw new UpdaterError('更新服务未配置', 503)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(`${normalizeBaseUrl(config.UPDATER_URL!)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.UPDATE_TOKEN}`,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    })
    const body = await readJson(response)
    if (!response.ok) {
      const statusCode = response.status === 401 ? 502 : response.status
      throw new UpdaterError(textFromBody(body, '更新服务请求失败'), statusCode)
    }
    return body as T
  } catch (err) {
    if (err instanceof UpdaterError) throw err
    const message = err instanceof Error && err.name === 'AbortError'
      ? '更新服务请求超时'
      : '更新服务不可用'
    throw new UpdaterError(message, 502)
  } finally {
    clearTimeout(timer)
  }
}

export async function checkSystemUpdates(): Promise<UpdateCheck> {
  if (!updaterConfigured()) {
    return unavailableCheck('更新服务未配置')
  }
  try {
    const result = await callUpdater<Omit<UpdateCheck, 'updaterAvailable'>>('/check', {
      method: 'POST',
    })
    return {
      ...result,
      updaterAvailable: true,
    }
  } catch (err) {
    return unavailableCheck(err instanceof Error ? err.message : '更新服务不可用')
  }
}

export async function startSystemUpdate(): Promise<UpdateTask> {
  const result = await callUpdater<UpdateTask>('/update', {
    method: 'POST',
  })
  return { ...result, updaterAvailable: true }
}

export async function getSystemUpdateStatus(): Promise<UpdateTask> {
  if (!updaterConfigured()) {
    return unavailableStatus('更新服务未配置')
  }
  try {
    const result = await callUpdater<UpdateTask>('/status', {
      method: 'GET',
    })
    return { ...result, updaterAvailable: true }
  } catch (err) {
    return unavailableStatus(err instanceof Error ? err.message : '更新服务不可用')
  }
}
