/**
 * 跨实例共享状态用的 Redis 客户端。
 *
 * Redis 是可选的：未配置 REDIS_URL 时 getRedis() 返回 null，调用方（限流、
 * 并发门、粘性会话）退回各自的进程内存实现。配置 REDIS_URL 后，这些状态
 * 就能在负载均衡后的多个副本间共享。
 *
 * 客户端在首次使用时惰性创建，整个进程复用。连接错误只记录日志、不在这里
 * 抛出——由各调用方决定如何降级（限流/粘性会话的辅助函数选择 fail open，
 * 即放行而不是阻塞流量）。
 */

import Redis from 'ioredis'
import { config } from '../config'

let client: Redis | null | undefined

/** 返回共享的 Redis 客户端；未配置 REDIS_URL 时返回 null。 */
export function getRedis(): Redis | null {
  if (client !== undefined) return client
  if (!config.REDIS_URL) {
    client = null
    return null
  }
  const redis = new Redis(config.REDIS_URL, {
    // Redis 不可达时不要无限排队命令——快速失败，让限流辅助函数可以 fail open，
    // 而不是把请求挂住。
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  })
  redis.on('error', (err) => {
    console.error('[redis] connection error:', (err as Error).message)
  })
  client = redis
  return redis
}

/** 关闭共享客户端（用于优雅退出 / 测试）。 */
export async function closeRedis(): Promise<void> {
  if (client) await client.quit().catch(() => {})
  client = undefined
}
