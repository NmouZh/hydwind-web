import type { APIRoute } from 'astro';
import { registerAccount } from '../../../lib/accounts';
import { requireAdmin } from '../../../lib/auth';
import { consumeRateLimit } from '../../../lib/rate-limit';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * POST /api/auth/register
 *
 * 只给插件调用：群里 @机器人 发「注册」后，插件带上对方的 QQ 号和游戏 ID 打这里，
 * 拿到账号密码再私信玩家。用的还是站务令牌，所以站点本身不开放自助注册。
 *
 * body: { username, platformId, platform?, nickname?, password?, role? }
 * resp: { username, password, role, created }
 */
export const POST: APIRoute = async ({ request }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const limit = consumeRateLimit('register', 60, 10 * 60_000);
  if (!limit.ok) return json({ error: '注册太频繁啦，稍后再试' }, 429);

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const result = await registerAccount({
    username: payload.username,
    platformId: payload.platformId,
    platform: payload.platform,
    nickname: payload.nickname,
    password: payload.password,
    role: payload.role,
  });

  if (!result.ok) return json({ error: result.message }, 400);
  return json(result.value);
};
