import type { APIRoute } from 'astro';
import { normalizeUsername, publicAccount, verifyLogin } from '../../../lib/accounts.ts';
import { isJson, json } from '../../../lib/api-response.ts';
import { clientIpKey } from '../../../lib/client-ip.ts';
import { consumeRateLimit, resetRateLimit } from '../../../lib/rate-limit.ts';
import { isSameOriginRequest } from '../../../lib/same-origin.ts';
import { createSessionCookie } from '../../../lib/session.ts';

/**
 * POST /api/auth/login  body: { username, password }
 *
 * 这一层只做「拒绝不合理请求」，账号比对交给 accounts.ts：
 * - 同源校验：浏览器里别的站 POST 过来会带不一样 Origin；插件调用不带 Origin，放行。
 * - 请求体上限：登录请求只有一个账号一个密码，超过 1KB 一律不收，防大包拖死 scrypt。
 * - 三层限流：IP 总请求挡脚本刷；账号+IP 失败上限挡定向爆破；账号跨 IP 失败上限挡分布式爆破。
 *   成功登录会清掉失败计数，正常用户不会因为登录次数被锁。
 * - 失败文案统一：不区分「没这个号」和「密码错」，日志里也不留密码。
 */

const MAX_BODY_BYTES = 1024;
const WINDOW_MS = 10 * 60_000;
/** IP 总请求上限：只用于限制 scrypt 的 CPU 占用，不用于判断密码是否正确。 */
const IP_LIMIT = 60;
/** 同一账号 + 同一 IP 的失败上限：防止定向密码爆破，也不让正常登录消耗额度。 */
const FAIL_LIMIT_PER_IP = 5;
/** 同一账号跨 IP 的失败上限：防止分布式爆破。 */
const FAIL_LIMIT_PER_ACCOUNT = 30;

const tooMany = (retryAfterMs: number) =>
  json({ error: '尝试太多次了，过几分钟再来' }, 429, {
    'retry-after': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
  });

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  if (!isSameOriginRequest(request)) return json({ error: '请求来源不对' }, 403);
  if (!isJson(request)) return json({ error: '请求体必须是 JSON' }, 415);

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: '请求体太大' }, 413);
  }

  const ip = clientIpKey(clientAddress);
  const ipLimit = consumeRateLimit(`login:ip:${ip}`, IP_LIMIT, WINDOW_MS);
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfterMs);

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json({ error: '请求体太大' }, 413);
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return json({ error: '请求体太大' }, 413);
  }

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

  // 归一化之后再按账号计数，避免 Nz / nz / nZ 各刷一份额度。
  const accountKey = normalizeUsername(username).toLowerCase() || username.toLowerCase();
  const ipFailureKey = `login:fail:ip:${accountKey}:${ip}`;
  const accountFailureKey = `login:fail:acct:${accountKey}`;

  // 先查失败额度再算 scrypt：被锁定的账号不应该继续消耗 CPU。
  const ipFailures = consumeRateLimit(ipFailureKey, FAIL_LIMIT_PER_IP, WINDOW_MS);
  if (!ipFailures.ok) return tooMany(ipFailures.retryAfterMs);
  const accountFailures = consumeRateLimit(accountFailureKey, FAIL_LIMIT_PER_ACCOUNT, WINDOW_MS);
  if (!accountFailures.ok) return tooMany(accountFailures.retryAfterMs);

  const account = await verifyLogin(username, password);
  if (!account) {
    // 审计日志只记账号和 IP，不记密码；统一文案避免账号枚举。
    console.warn(
      `[auth] login failed account=${normalizeUsername(username) || '(invalid)'} ip=${ip}`
    );
    return json({ error: '账号或密码不对' }, 401);
  }

  console.info(`[auth] login ok account=${account.username} ip=${ip}`);

  // 成功登录清掉失败计数；IP 总请求额度仍保留，防止用成功登录刷 scrypt。
  resetRateLimit(ipFailureKey);
  resetRateLimit(accountFailureKey);

  // 协议以真实请求为准；反代后面优先看 X-Forwarded-Proto，避免 https 站点下发非 Secure cookie
  const forwardedProto = (request.headers.get('x-forwarded-proto') ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const protocol = forwardedProto || new URL(request.url).protocol.replace(':', '');
  createSessionCookie(
    cookies,
    account.username,
    account.role,
    protocol === 'https',
    account.sessionVersion ?? 0
  );
  return json({ account: publicAccount(account) });
};
