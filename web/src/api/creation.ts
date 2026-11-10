import { isAxiosError } from 'axios'
import { api } from './client'
import type { SessionRole } from '../stores/auth'

export const VIDEO_MODEL = 'minimax-h3'
export const IMAGE_MODELS = [
  { id: 'gpt-image-2.6', qualities: ['auto'] },
  { id: 'gpt-image-2.5', qualities: ['auto'] },
  { id: 'gpt-image-2', qualities: ['auto'] },
  { id: 'gpt-image-2-vip', qualities: ['medium'] },
  { id: 'gpt-image-2.5-flare', qualities: ['low', 'medium', 'high'] },
  { id: 'gpt-image-2.5-sunburst', qualities: ['low', 'medium', 'high', 'xhigh', 'max'] },
] as const

export type CreationMode = 'image' | 'video'
export type TaskStatus = 'running' | 'succeeded' | 'failed' | 'violation'

export interface CreationTask {
  id: string
  object: CreationMode
  status: TaskStatus
  progress: number
  results: Array<{ studio_url?: string }>
  error?: string
}

interface ImageSettings {
  model: string
  prompt: string
  size: string
  quality: string
}

interface VideoSettings {
  prompt: string
  aspectRatio: 'landscape' | 'portrait'
  resolution: '480p' | '768p' | '1080p'
  duration: number
}

export class CreationRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export function mediaUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && /^\/api\/media\/v1\/studio-file\?ticket=[\w-]+\.[\w-]+$/.test(value)) return value
}

async function mediaRequest<T>(role: SessionRole, path: string, signal: AbortSignal, body?: object, groupId?: string): Promise<T> {
  const namespace = role === 'admin' ? 'admin' : 'users'
  try {
    const { data } = await api.request<T>({
      url: `/${namespace}/studio${path}`,
      method: body ? 'POST' : 'GET',
      data: body,
      params: groupId ? { groupId } : undefined,
      headers: { 'X-Model-Bridge-Studio': '1' },
      signal,
    })
    if (data == null || typeof data !== 'object') throw new Error('服务返回了无法读取的结果。')
    return data
  } catch (requestError) {
    if (!isAxiosError(requestError) || !requestError.response) throw requestError
    const { data, status } = requestError.response
    const error = data?.error
    const message = typeof error === 'string' ? error : error?.message
    throw new CreationRequestError(message || `请求失败（HTTP ${status}）`, status)
  }
}

function readReference(reference: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('无法读取参考图。'))
    reader.readAsDataURL(reference)
  })
}

function taskPath(mode: CreationMode): string {
  return mode === 'image' ? '/image-tasks' : '/videos'
}

export async function createTask(
  role: SessionRole, settings: ImageSettings | VideoSettings, reference: File | null, signal: AbortSignal, groupId?: string,
): Promise<CreationTask> {
  const images = reference ? [await readReference(reference)] : undefined
  if ('size' in settings) {
    const { size, ...fields } = settings
    return mediaRequest(role, taskPath('image'), signal, { ...fields, aspectRatio: size, images }, groupId)
  }
  return mediaRequest(role, taskPath('video'), signal, { model: VIDEO_MODEL, ...settings, images }, groupId)
}

export function getTask(role: SessionRole, mode: CreationMode, id: string, signal: AbortSignal): Promise<CreationTask> {
  return mediaRequest(role, `${taskPath(mode)}/${encodeURIComponent(id)}`, signal)
}
