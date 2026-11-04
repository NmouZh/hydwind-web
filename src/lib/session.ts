import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import type { AccountRole } from './accounts';

/**
 * 无状态会话：cookie 里存 base64url(payload) + HMAC 签名，服务端不落库。
 *
 * 签名密钥优先用 SESSION_SECRET，没配就退回 ISSUE_ADMIN_TOKEN，
 * 两者都没有时用固定开发密钥并在控制台警告——上线前必须配一个。
 */

export const SESSION_COOKIE = 'hydwind_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface SessionPayload {
  username: string;
  role: AccountRole;
  /** 过期时间（秒） */
  exp: number;
}

const secret = (): string => {
  const value = process.env.SESSION_SECRET ?? process.env.ISSUE_ADMIN_TOKEN;
  if (value && value.length >= 16) return value;
  console.warn('[auth] 未配置 SESSION_SECRET，正在使用开发密钥，请不要这样上线');
  return 'hydwind-dev-session-secret';
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

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload?.username) return null;
    if (payload.exp * 1000 < Date.now()) return null;
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
  secure = process.env.NODE_ENV !== 'development'
): void => {
  const payload: SessionPayload = {
    username,
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
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
  const match = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;

  try {
    return decode(decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)));
  } catch {
    // 畸形 cookie 不该把接口打成 500，当作未登录
    return null;
  }
};
