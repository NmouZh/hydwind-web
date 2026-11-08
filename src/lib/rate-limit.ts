/**
 * 进程内滑动窗口限流。
 *
 * 只防一下脚本刷接口，重启即清空；多实例部署时需要换成 Redis 之类。
 */
interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5_000;

/**
 * 桶满了先清掉已经过窗口的键，再按最久未活动淘汰 10%。
 *
 * 旧实现直接 `buckets.clear()`：攻击者只要凑够 5000 个不同的键（伪造
 * X-Forwarded-For、随机账号名）就能把所有人的限流额度一起清零。淘汰必须
 * 是局部的，不能因为内存压力反过来给攻击者送额度。
 */
const evict = (now: number, windowMs: number): void => {
  for (const [key, bucket] of buckets) {
    const last = bucket.hits[bucket.hits.length - 1];
    if (last === undefined || now - last >= windowMs) buckets.delete(key);
  }

  if (buckets.size < MAX_KEYS) return;

  const oldest = [...buckets.entries()].sort(
    (a, b) => (a[1].hits[0] ?? 0) - (b[1].hits[0] ?? 0)
  );
  const drop = Math.max(1, Math.ceil(oldest.length * 0.1));
  for (let index = 0; index < drop && index < oldest.length; index += 1) {
    buckets.delete(oldest[index][0]);
  }
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
  if (buckets.size >= MAX_KEYS) evict(now, windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((at) => now - at < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now;
    buckets.set(key, bucket);
    return { ok: false, remaining: 0, retryAfterMs: windowMs - (now - oldest) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.hits.length, retryAfterMs: 0 };
};

/** 登录成功后清掉失败计数：成功本身不应该消耗失败额度。 */
export const resetRateLimit = (key: string): void => {
  buckets.delete(key);
};
