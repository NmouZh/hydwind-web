import type { APIRoute } from 'astro';
import { findAccount, type Account } from '../../../../lib/accounts.ts';
import { isJson, json } from '../../../../lib/api-response.ts';
import { ensureBiographyForAccount } from '../../../../lib/biographies.ts';
import { verifyLoginCode } from '../../../../lib/login-codes.ts';
import { requirePlugin } from '../../../../lib/plugin-auth.ts';

/**
 * POST /api/plugin/login/verify —— HydwindGate 插件校验玩家登录码。
 *
 * 契约见 https://github.com/NmouZh/hydwind-web/blob/main/docs/backend-api.md：
 *   Authorization: Bearer <PLUGIN_TOKEN>
 *   { code, gameId, uuid }
 *   → 200 { ok: true, account: { username, nickname, role } }
 *   → 401 令牌错误
 *   → 409 { ok: false, reason: invalid_code|expired|used|game_id_mismatch, expectedGameId? }
 *   → 429 { ok: false, reason: "rate_limited", retryAfterMs, attemptsRemaining }
 *
 * 只接受 PLUGIN_TOKEN：站务令牌和浏览器会话都不该能调这个接口。请求体上限
 * 1KB，插件一次只发一个码和一个 UUID，没有理由更大。
 *
 * uuid 目前不参与鉴权，只作为成功校验的审计上下文写入日志，方便把插件侧
 * 的登录记录和网站侧对上；契约里保留该字段。
 */

const MAX_BODY_BYTES = 1024;
const MAX_CODE_LENGTH = 128;
const MAX_GAME_ID_LENGTH = 64;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalidRequest = (reason: string, status: number) => json({ ok: false, reason }, status);

const conflict = (
  reason: 'invalid_code' | 'expired' | 'used' | 'game_id_mismatch',
  expectedGameId?: string
) => json(expectedGameId ? { ok: false, reason, expectedGameId } : { ok: false, reason }, 409);

export const POST: APIRoute = async ({ request }) => {
  const denied = requirePlugin(request);
  if (denied) return denied;

  if (!isJson(request)) return invalidRequest('unsupported_media_type', 415);

  // 先看声明长度，避免无谓地读一大包；读出来后再按实际长度兜底一次
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return invalidRequest('payload_too_large', 413);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return invalidRequest('payload_too_large', 413);
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return invalidRequest('payload_too_large', 413);
  }

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

  // 账号检查放在 beforeConsume 里：账号不存在或名字对不上时，登录码保持未使用，
  // 玩家改对游戏 ID 后仍可用同一个码，不会因为一次失败就烧掉。
  let matchedAccount: Account | null = null;

  // 用模块内共享的 defaultStore：/gate 生成码和插件校验码必须落在同一个存储里
  const result = await verifyLoginCode(
    { code, gameId },
    {
      beforeConsume: async (record) => {
        const account = await findAccount(record.username);
        if (!account) return { reason: 'invalid_code' };
        if (account.username.toLowerCase() !== gameId.toLowerCase()) {
          return { reason: 'game_id_mismatch', expectedGameId: account.username };
        }
        matchedAccount = account;
        return true;
      },
    }
  );

  if (!result.ok) {
    const { reason } = result;
    if (reason === 'rate_limited') {
      const retryAfterMs = result.retryAfterMs ?? 0;
      return json(
        {
          ok: false,
          reason,
          retryAfterMs,
          attemptsRemaining: result.attemptsRemaining ?? 0,
        },
        429,
        {
          'retry-after': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
        }
      );
    }
    return conflict(reason, result.expectedGameId);
  }

  const account = matchedAccount as Account | null;
  if (!account) return conflict('invalid_code');

  console.info(
    `[plugin-login] verified username=${account.username} uuid=${uuid}`
  );

  try {
    await ensureBiographyForAccount(account);
  } catch (error) {
    console.error(`[plugin-login] biography creation failed username=${account.username}`, error);
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