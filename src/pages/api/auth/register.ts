import type { APIRoute } from 'astro';
import { registerAccount } from '../../../lib/accounts';
import { isJson, json, readJsonObject } from '../../../lib/api-response.ts';
import { requireAdmin } from '../../../lib/auth';
import { clientIpKey } from '../../../lib/client-ip.ts';
import { consumeRateLimit } from '../../../lib/rate-limit';

const MAX_BODY_BYTES = 2 * 1024;

/**
 * POST /api/auth/register
 *
 * 只给插件调用：群里 @机器人 发「注册」后，插件带上对方的 QQ 号和游戏 ID 打这里，
 * 拿到账号密码再私信玩家。用的还是站务令牌，所以站点本身不开放自助注册。
 *
 * body: { username, platformId, platform?, nickname?, password?, role? }
 * resp: { username, password, role, created }
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;

  if (!isJson(request)) return json({ error: '请求体必须是 JSON' }, 415);

  const limit = consumeRateLimit(
    `register:${clientIpKey(clientAddress)}`,
    20,
    10 * 60_000
  );
  if (!limit.ok) return json({ error: '注册太频繁啦，稍后再试' }, 429);

  const parsed = await readJsonObject(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;

  // 注册接口只负责创建普通玩家。管理员账号必须由站务在服务器侧明确操作，
  // 不能靠一个请求体里的 role 字段提权。
  const requestedRole = payload.role;
  if (requestedRole === 'admin' && process.env.HYDWIND_ALLOW_ADMIN_REGISTER !== '1') {
    return json({ error: '注册接口不能创建管理员账号' }, 403);
  }

  const result = await registerAccount({
    username: payload.username,
    platformId: payload.platformId,
    platform: payload.platform,
    nickname: payload.nickname,
    password: payload.password,
    role: requestedRole,
  });

  if (!result.ok) return json({ error: result.message }, 400);
  return json(result.value);
};
