import { createHmac, randomBytes } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { ACCOUNT_ROLES, type AccountRole } from './accounts.ts';
import { timingSafeEqualString } from './timing-safe.ts';

/**
 * 无状态会话：cookie 里存 base64url(payload) + HMAC 签名，服务端不落库。
 *
 * 签名密钥只取 SESSION_SECRET，不再退回 ISSUE_ADMIN_TOKEN：站务令牌出现在
 * 插件配置、备份和日志里的机会更多，复用它签名等于把会话伪造能力扩散出去。
 * 没配置时生成一个进程内随机密钥：开发时照常能登录，但绝不能靠一个写死在
 * 仓库里的字符串给线上签名。随机密钥的代价是进程重启后所有会话失效，
 * 生产环境由 scripts/check-env.mjs 强制要求配置。
 */

export const SESSION_COOKIE = 'hydwind_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MIN_SECRET_LENGTH = 16;
const RECOMMENDED_SECRET_LENGTH = 32;

export interface SessionPayload {
  username: string;
  role: AccountRole;
  /** 过期时间（秒） */
  exp: number;
  /** 账号的会话代际；改密码后旧 cookie 自动失效。旧 token 没有该字段时按 0 处理。 */
  v?: number;
}

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

let cachedSecret: string | null = null;

const secret = (): string => {
  if (cachedSecret) return cachedSecret;

  const value = process.env.SESSION_SECRET?.trim();
  // 不再退回 ISSUE_ADMIN_TOKEN：站务令牌在插件配置、日志、备份里出现的机会多，
  // 拿它给会话签名等于“拿到站务令牌就能伪造任意玩家（包括管理员）的 cookie”。
  if (value && value.length >= MIN_SECRET_LENGTH) {
    if (value.length < RECOMMENDED_SECRET_LENGTH) {
      const message = `[auth] SESSION_SECRET 只有 ${value.length} 个字符，建议至少 ${RECOMMENDED_SECRET_LENGTH} 个`;
      if (isProduction()) throw new Error(message);
      console.warn(message);
    }
    if (process.env.ISSUE_ADMIN_TOKEN && value === process.env.ISSUE_ADMIN_TOKEN) {
      const message = '[auth] SESSION_SECRET 不能与 ISSUE_ADMIN_TOKEN 相同';
      if (isProduction()) throw new Error(message);
      console.warn(message);
    }
    cachedSecret = value;
    return cachedSecret;
  }

  const message =
    '[auth] 未配置 SESSION_SECRET（至少 16 字符），正在使用进程内随机密钥；进程重启后所有登录会失效，生产环境必须配置';
  if (isProduction()) {
    // 生产环境宁可让登录接口 500，也不要用一个重启即变、无法审计的密钥继续签发会话。
    console.error(message);
    throw new Error('SESSION_SECRET is required in production');
  }
  console.warn(message);

  cachedSecret = randomBytes(32).toString('hex');
  return cachedSecret;
};

const sign = (data: string): string =>
  createHmac('sha256', secret()).update(data).digest('base64url');

const toBase64Url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

const encode = (payload: SessionPayload): string => {
  const body = toBase64Url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
};

const decode = (token: string): SessionPayload | null => {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  if (!timingSafeEqualString(signature, sign(body))) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload || typeof payload.username !== 'string' || !payload.username) return null;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    if (!(ACCOUNT_ROLES as readonly string[]).includes(payload.role)) return null;
    if (payload.v !== undefined && (typeof payload.v !== 'number' || !Number.isInteger(payload.v))) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

export const createSessionCookie = (
  cookies: AstroCookies,
  username: string,
  role: AccountRole,
  /** 由请求的真实协议决定；拿不到时按非开发环境处理，宁可 Secure */
  secure = process.env.NODE_ENV !== 'development',
  /** 账号当前的会话代际；改密码后递增，旧 cookie 会被拒绝 */
  version = 0
): void => {
  const payload: SessionPayload = {
    username,
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    v: version,
  };
  cookies.set(SESSION_COOKIE, encode(payload), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
    secure,
  });
};

export const clearSessionCookie = (cookies: AstroCookies): void => {
  cookies.delete(SESSION_COOKIE, { path: '/' });
};

export const readSession = (cookies: AstroCookies): SessionPayload | null => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  return token ? decode(token) : null;
};

/** API 路由里用 request 直接解析，省得传 cookies 上下文。 */
export const readSessionFromRequest = (request: Request): SessionPayload | null => {
  const header = request.headers.get('cookie') ?? '';
  const prefix = `${SESSION_COOKIE}=`;
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix))
    .map((part) => part.slice(prefix.length));

  // 同名 cookie 出现多个不同值时（子域 cookie tossing）一律视为未登录，
  // 避免攻击者用自己域下的同名 cookie 覆盖或干扰真实会话。
  if (values.length === 0) return null;
  const unique = new Set(values);
  if (unique.size !== 1) return null;

  try {
    return decode(decodeURIComponent(values[0]));
  } catch {
    // 畸形 cookie 不该把接口打成 500，当作未登录
    return null;
  }
};
