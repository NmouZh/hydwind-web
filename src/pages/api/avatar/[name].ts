import type { APIRoute } from 'astro';
import { clientIpKey } from '../../../lib/client-ip.ts';
import { consumeRateLimit } from '../../../lib/rate-limit.ts';

/**
 * 在线玩家头像。
 *
 * 页面只请求同源的 `/api/avatar/:name`，由服务端去问 Mojang：
 * - 是正版账号 → 拿官方 profile 的 UUID，再用头像服务渲染本人皮肤；
 * - 不是 / 查不到 / 上游挂了 → 回退到本地从 Mojang 默认皮肤裁出的 Steve / Alex。
 *
 * 浏览器不直连第三方头像站。名字只允许 MC ID 的字符集，外部 URL 全部由
 * 固定域名 + 编码后的值拼成；不跟随重定向、限制响应体大小与缓存总量，
 * 避免一个名字把内存或带宽吃穿。
 */

const ALLOWED = /^[A-Za-z0-9_]{1,16}$/;
const CACHE_TTL = 24 * 60 * 60 * 1000;
// 上游临时失败只钉 1 分钟；永久不存在也复用这个短缓存，避免一次 429/超时
// 让某个玩家显示默认头像一小时。
const MISS_TTL = 60 * 1000;
const MAX_ENTRIES = 500;
const MAX_MISSES = 2_000;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024;
const IP_LIMIT_PER_MINUTE = 300;

interface CachedAvatar {
  body: Buffer;
  type: string;
  at: number;
}

const cache = new Map<string, CachedAvatar>();
const misses = new Map<string, number>();
const inflight = new Map<string, Promise<CachedAvatar | null>>();
let cachedBytes = 0;

const DEFAULTS = [
  '/images/avatars/default-steve.png',
  '/images/avatars/default-alex.png',
] as const;

/** FNV-1a：同一个名字永远落到同一个默认角色，刷新不会来回换。 */
const hashOf = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
};

const defaultRedirect = (name: string, cacheSeconds = 3600): Response => {
  const target = DEFAULTS[hashOf(name.toLowerCase()) % DEFAULTS.length];
  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      'cache-control':
        cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
    },
  });
};

const imageResponse = (cached: CachedAvatar, source: string): Response =>
  new Response(cached.body, {
    headers: {
      'content-type': cached.type,
      'cache-control': 'public, max-age=86400, s-maxage=86400',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      'x-avatar-source': source,
    },
  });

/** 记住一次未命中，且只保留最近的 {@link MAX_MISSES} 个，避免名字表无限增长。 */
const rememberMiss = (key: string): void => {
  misses.set(key, Date.now());
  while (misses.size > MAX_MISSES) {
    const oldest = misses.keys().next().value;
    if (oldest === undefined) break;
    misses.delete(oldest);
  }
};

/** 按插入顺序淘汰，直到条目数与总字节数都回到上限内。 */
const evictCache = (): void => {
  while (cache.size > MAX_ENTRIES || cachedBytes > MAX_TOTAL_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const entry = cache.get(oldest);
    cache.delete(oldest);
    if (entry) cachedBytes -= entry.body.byteLength;
  }
};

/** 上游响应体上限；超过直接取消读取，绝不先 arrayBuffer 再检查。 */
const readBodyLimited = async (response: Response, maxBytes: number): Promise<Buffer | null> => {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
};

const loadAvatar = async (name: string, key: string): Promise<CachedAvatar | null> => {
  try {
    const profileResponse = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
      {
        signal: AbortSignal.timeout(8000),
        redirect: 'manual',
        headers: { accept: 'application/json' },
      }
    );

    // 204 表示没有这个正版账号；3xx 也按未命中处理，不跟随。
    if (!profileResponse.ok) return null;

    const profileBody = await readBodyLimited(profileResponse, 8 * 1024);
    if (!profileBody) return null;
    const profile = JSON.parse(profileBody.toString('utf8')) as { id?: unknown };
    const id = typeof profile.id === 'string' ? profile.id : '';
    if (!/^[0-9a-f]{32}$/i.test(id)) return null;

    const avatarResponse = await fetch(`https://mc-heads.net/avatar/${id}/64`, {
      signal: AbortSignal.timeout(8000),
      redirect: 'manual',
      headers: { accept: 'image/png,image/*' },
    });
    if (!avatarResponse.ok) return null;

    const type = (avatarResponse.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (type !== 'image/png' && type !== 'image/jpeg' && type !== 'image/webp') return null;

    const body = await readBodyLimited(avatarResponse, MAX_ENTRY_BYTES);
    if (!body || body.byteLength === 0) return null;

    const entry: CachedAvatar = { body, type, at: Date.now() };
    const previous = cache.get(key);
    if (previous) cachedBytes -= previous.body.byteLength;
    cache.delete(key);
    cache.set(key, entry);
    cachedBytes += body.byteLength;
    evictCache();
    return entry;
  } catch {
    return null;
  }
};

export const GET: APIRoute = async ({ params, clientAddress }) => {
  const name = (params.name ?? '').trim();
  if (!ALLOWED.test(name)) return defaultRedirect('steve');

  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    // 命中时移到队尾，保持 LRU 语义。
    cache.delete(key);
    cache.set(key, cached);
    return imageResponse(cached, 'cache');
  }
  if (cached) {
    cache.delete(key);
    cachedBytes -= cached.body.byteLength;
  }

  const missedAt = misses.get(key);
  if (missedAt && Date.now() - missedAt < MISS_TTL) {
    return defaultRedirect(name, 60);
  }

  // 同一个名字的并发请求合并成一次上游调用，避免列表页一次性打爆头像站。
  const pending = inflight.get(key);
  if (pending) {
    const entry = await pending;
    return entry ? imageResponse(entry, 'shared') : defaultRedirect(name, 60);
  }

  // 只有真正要打上游时才消耗配额；缓存命中/负缓存不应该被限流影响。
  // 被限流时也不要用 1 小时缓存，否则窗口过去后仍一直显示默认头像。
  const limit = consumeRateLimit(
    `avatar:${clientIpKey(clientAddress)}`,
    IP_LIMIT_PER_MINUTE,
    60_000
  );
  if (!limit.ok) return defaultRedirect(name, 0);

  const request = loadAvatar(name, key);
  inflight.set(key, request);

  try {
    const entry = await request;
    if (!entry) {
      rememberMiss(key);
      return defaultRedirect(name, 60);
    }
    return imageResponse(entry, 'mojang');
  } finally {
    inflight.delete(key);
  }
};