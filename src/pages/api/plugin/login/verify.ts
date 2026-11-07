import type { APIRoute } from 'astro';
import { findAccount } from '../../../../lib/accounts.ts';
import { verifyLoginCode } from '../../../../lib/login-codes.ts';
import { requirePlugin } from '../../../../lib/plugin-auth.ts';

/**
 * POST /api/plugin/login/verify —— HydwindGate 插件校验玩家登录码。
 *
 * 契约见 docs/specs/0001-login-gate.md：
 *   Authorization: Bearer <PLUGIN_TOKEN>
 *   { code, gameId, uuid }
 *   → 200 { ok: true, account: { username, nickname, role } }
 *   → 401 令牌错误
 *   → 409 { ok: false, reason: invalid_code|expired|used|game_id_mismatch }
 *   → 429 { ok: false, reason: "rate_limited", retryAfterMs }
 *
 * 只接受 PLUGIN_TOKEN：站务令牌和浏览器会话都不该能调这个接口。请求体上限
 * 1KB，插件一次只发一个码和一个 UUID，没有理由更大。
 */

const MAX_BODY_BYTES = 1024;
const MAX_CODE_LENGTH = 128;
const MAX_GAME_ID_LENGTH = 64;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

const invalidRequest = (reason: string, status: number) => json({ ok: false, reason }, status);

const conflict = (reason: 'invalid_code' | 'expired' | 'used' | 'game_id_mismatch') =>
  json({ ok: false, reason }, 409);

const isJson = (request: Request): boolean =>
  (request.headers.get('content-type') ?? '').toLowerCase().includes('application/json');

export const POST: APIRoute = async ({ request }) => {
  const denied = requirePlugin(request);
  if (denied) return denied;

  if (!isJson(request)) return invalidRequest('unsupported_media_type', 415);

  // 先看声明长度，避免无谓地读一大包；读出来后再按实际长度兜底一次
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return invalidRequest('payload_too_large', 413);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return invalidRequest('payload_too_large', 413);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return invalidRequest('bad_request', 400);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalidRequest('bad_request', 400);
  }

  const code = typeof payload.code === 'string' ? payload.code.trim() : '';
  const gameId = typeof payload.gameId === 'string' ? payload.gameId.trim() : '';
  const uuid = typeof payload.uuid === 'string' ? payload.uuid.trim() : '';

  if (
    !code ||
    !gameId ||
    code.length > MAX_CODE_LENGTH ||
    gameId.length > MAX_GAME_ID_LENGTH ||
    !UUID_PATTERN.test(uuid)
  ) {
    return invalidRequest('bad_request', 400);
  }

  // 用模块内共享的 defaultStore：/gate 生成码和插件校验码必须落在同一个存储里
  const result = verifyLoginCode({ code, gameId });

  if (!result.ok) {
    const { reason } = result;
    if (reason === 'rate_limited') {
      const retryAfterMs = result.retryAfterMs ?? 0;
      return json({ ok: false, reason, retryAfterMs }, 429, {
        'retry-after': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
      });
    }
    return conflict(reason);
  }

  // 码有效只证明「这个码属于这个游戏 ID」；账号必须仍然存在，
  // 且游戏 ID 必须等于账号名，否则同一个 QQ 换 ID 后旧码会泄漏身份
  const account = await findAccount(result.username);
  if (!account) return conflict('invalid_code');
  if (account.username.toLowerCase() !== gameId.toLowerCase()) {
    return conflict('game_id_mismatch');
  }

  return json({
    ok: true,
    account: {
      username: account.username,
      nickname: account.nickname,
      role: account.role,
    },
  });
};