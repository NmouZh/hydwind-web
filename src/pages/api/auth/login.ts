import type { APIRoute } from 'astro';
import { normalizeUsername, publicAccount, verifyLogin } from '../../../lib/accounts';
import { consumeRateLimit } from '../../../lib/rate-limit';
import { createSessionCookie } from '../../../lib/session';

/**
 * POST /api/auth/login  body: { username, password }
 *
 * 这一层只做「拒绝不合理请求」，账号比对交给 accounts.ts：
 * - 同源校验：浏览器里别的站 POST 过来会带不一样 Origin；插件调用不带 Origin，放行。
 * - 请求体上限：登录请求只有一个账号一个密码，超过 1KB 一律不收，防大包拖死 scrypt。
 * - 双维度限流：IP 挡脚本刷，账号挡换 IP 撞同一个号，两条命中任意一条就 429。
 * - 失败文案统一：不区分「没这个号」和「密码错」，日志里也不留密码。
 */

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

const MAX_BODY_BYTES = 1024;
const WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 10;
const USER_LIMIT = 5;

/** Origin 存在时必须和本站同源；没有 Origin 的（curl、插件）交给限流和令牌去管。 */
const isSameOrigin = (request: Request): boolean => {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
};

const isJson = (request: Request): boolean =>
  (request.headers.get('content-type') ?? '').toLowerCase().includes('application/json');

const tooMany = (retryAfterMs: number) =>
  json({ error: '尝试太多次了，过几分钟再来' }, 429, {
    'retry-after': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
  });

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  if (!isSameOrigin(request)) return json({ error: '请求来源不对' }, 403);
  if (!isJson(request)) return json({ error: '请求体必须是 JSON' }, 415);

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: '请求体太大' }, 413);
  }

  const ip = clientAddress ?? 'unknown';
  const ipLimit = consumeRateLimit(`login:ip:${ip}`, IP_LIMIT, WINDOW_MS);
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfterMs);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: '请求体太大' }, 413);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ error: '请求体格式不对' }, 400);
  }

  const username = typeof payload.username === 'string' ? payload.username.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';

  if (!username || !password) return json({ error: '账号和密码都要填' }, 400);
  if (username.length > 64 || password.length > 200) {
    return json({ error: '账号或密码太长' }, 400);
  }

  // 归一化之后再按账号计数，避免 Nz / nz / nZ 各刷一份额度
  const accountKey = normalizeUsername(username).toLowerCase() || username.toLowerCase();
  const userLimit = consumeRateLimit(`login:user:${accountKey}`, USER_LIMIT, WINDOW_MS);
  if (!userLimit.ok) return tooMany(userLimit.retryAfterMs);

  const account = await verifyLogin(username, password);
  if (!account) return json({ error: '账号或密码不对' }, 401);

  createSessionCookie(cookies, account.username, account.role);
  return json({ account: publicAccount(account) });
};
