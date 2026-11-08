/**
 * 进程内滑动窗口限流。
 *
 * 只防一下脚本刷接口，重启即清空；多实例部署时需要换成 Redis 之类。
 */
interface Bucket {
  hits: number[];
  /** 这个桶自己的窗口；不同 key 的窗口可能不同（60s 头像 vs 10min 登录）。 */
  windowMs: number;
  /** 最近一次命中时间；被限流的请求也算，避免活跃桶被误判为最旧。 */
  lastSeen: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5_000;

/**
 * 桶满了只按每个桶自己的窗口清理过期条目，绝不删除仍活跃的桶。
 *
 * 旧实现用调用方的窗口清理所有桶（60s 的请求会清掉 10min 的登录桶），
 * 还会一次删 10%——攻击者可以靠填满 map 重置别人的活跃额度。清理后仍然
 * 满时，新 key 直接 fail-closed 返回 429；已存在的 key 继续正常计数。
 *
 * @return 是否腾出了空间
 */
const pruneExpired = (now: number): boolean => {
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastSeen >= bucket.windowMs) buckets.delete(key);
  }
  return buckets.size < MAX_KEYS;
};

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export const consumeRateLimit = (
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult => {
  const existing = buckets.get(key);
  if (!existing && buckets.size >= MAX_KEYS && !pruneExpired(now)) {
    // 桶被攻击者用随机 key 填满：拒绝新 key，而不是淘汰活跃用户/账号的额度。
    return { ok: false, remaining: 0, retryAfterMs: Math.min(windowMs, 60_000) };
  }

  const bucket = existing ?? { hits: [], windowMs, lastSeen: now };
  bucket.windowMs = windowMs;
  bucket.lastSeen = now;
  bucket.hits = bucket.hits.filter((at) => now - at < bucket.windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now;
    buckets.set(key, bucket);
    return { ok: false, remaining: 0, retryAfterMs: bucket.windowMs - (now - oldest) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.hits.length, retryAfterMs: 0 };
};

/** 登录成功后清掉失败计数：成功本身不应该消耗失败额度。 */
export const resetRateLimit = (key: string): void => {
  buckets.delete(key);
};
