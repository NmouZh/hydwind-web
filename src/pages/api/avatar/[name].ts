import type { APIRoute } from 'astro';

/**
 * 在线玩家头像。
 *
 * 页面只请求同源的 `/api/avatar/:name`，由服务端去问 Mojang：
 * - 是正版账号 → 拿官方 profile 的 UUID，再用头像服务渲染本人皮肤；
 * - 不是 / 查不到 / 上游挂了 → 回退到本地从 Mojang 默认皮肤裁出的 Steve / Alex。
 *
 * 这样浏览器不直连第三方头像站，默认头像也是官方素材；结果缓存 24 小时。
 * 名字只允许 MC ID 的字符集，外部 URL 全部由固定域名 + 编码后的值拼成。
 */

const ALLOWED = /^[A-Za-z0-9_]{1,16}$/;
const CACHE_TTL = 24 * 60 * 60 * 1000;
const MISS_TTL = 60 * 60 * 1000;
const MAX_ENTRIES = 500;

interface CachedAvatar {
  body: Buffer;
  type: string;
  at: number;
}

const cache = new Map<string, CachedAvatar>();
const misses = new Map<string, number>();

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

const defaultRedirect = (name: string): Response => {
  const target = DEFAULTS[hashOf(name.toLowerCase()) % DEFAULTS.length];
  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      'cache-control': 'public, max-age=3600',
    },
  });
};

const imageResponse = (cached: CachedAvatar, source: string): Response =>
  new Response(cached.body, {
    headers: {
      'content-type': cached.type,
      'cache-control': 'public, max-age=86400, s-maxage=86400',
      'x-avatar-source': source,
    },
  });

export const GET: APIRoute = async ({ params }) => {
  const name = (params.name ?? '').trim();
  if (!ALLOWED.test(name)) return defaultRedirect('steve');

  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return imageResponse(cached, 'cache');
  }

  const missedAt = misses.get(key);
  if (missedAt && Date.now() - missedAt < MISS_TTL) {
    return defaultRedirect(name);
  }

  const miss = (): Response => {
    misses.set(key, Date.now());
    return defaultRedirect(name);
  };

  try {
    const profileResponse = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
      {
        signal: AbortSignal.timeout(12000),
        headers: { accept: 'application/json' },
      }
    );

    // 204 表示没有这个正版账号；429 等上游错误也按默认头像处理
    if (!profileResponse.ok) return miss();

    const profile = (await profileResponse.json()) as { id?: unknown };
    const id = typeof profile.id === 'string' ? profile.id : '';
    if (!/^[0-9a-f]{32}$/i.test(id)) return miss();

    const avatarResponse = await fetch(`https://mc-heads.net/avatar/${id}/64`, {
      signal: AbortSignal.timeout(12000),
      headers: { accept: 'image/png,image/*' },
    });
    if (!avatarResponse.ok) return miss();

    const type = (avatarResponse.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!type.startsWith('image/')) return miss();

    const body = Buffer.from(await avatarResponse.arrayBuffer());
    if (body.byteLength === 0) return miss();

    if (cache.size > MAX_ENTRIES) cache.clear();
    const entry: CachedAvatar = { body, type, at: Date.now() };
    cache.set(key, entry);
    return imageResponse(entry, 'mojang');
  } catch {
    return miss();
  }
};
