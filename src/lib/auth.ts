/**
 * 站务令牌校验。
 *
 * 站点本身没有账号系统，议题审核走「群内指令 → 插件 → 管理接口」这条链路。
 * 插件用环境变量 ISSUE_ADMIN_TOKEN 里的共享密钥调用写接口。
 */
import { findAccount, type Account } from './accounts.ts';
import { json } from './api-response.ts';
import { readSessionFromRequest, type SessionPayload } from './session.ts';
import { timingSafeEqualString } from './timing-safe.ts';

const ADMIN_TOKEN = () => process.env.ISSUE_ADMIN_TOKEN ?? '';

/**
 * 把会话落到真实账号：账号必须还存在，且会话代际与账号一致。
 *
 * 改密码会递增 `sessionVersion`，因此旧 cookie 立刻失效；只校验签名的
 * 话，密码泄露后的 30 天里旧会话仍然有效。
 */
export const accountForSession = async (
  session: SessionPayload | null
): Promise<Account | null> => {
  if (!session) return null;
  const account = await findAccount(session.username);
  if (!account) return null;
  if ((session.v ?? 0) !== (account.sessionVersion ?? 0)) return null;
  return account;
};

/** API 路由统一入口：解析 cookie 并回查账号。 */
export const readAccountFromRequest = async (request: Request): Promise<Account | null> =>
  accountForSession(readSessionFromRequest(request));

export const isAdmin = (request: Request): boolean => {
  const token = ADMIN_TOKEN();
  if (!token) return false;

  const header = request.headers.get('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const custom = request.headers.get('x-hydwind-token') ?? '';

  return (
    (bearer.length > 0 && timingSafeEqualString(bearer, token)) ||
    (custom.length > 0 && timingSafeEqualString(custom, token))
  );
};

/**
 * 站务判定：令牌，或「当前会话对应的账号仍然是 admin」。
 *
 * 只信 cookie 里的 role 会让降权拖到 30 天后才生效；这里每次回查账号，
 * 降权 / 角色调整立刻生效。账号文件是本地 JSON，成本可以忽略。
 */
export const isStaffRequest = async (request: Request): Promise<boolean> => {
  if (isAdmin(request)) return true;

  const account = await readAccountFromRequest(request);
  return account?.role === 'admin';
};

/** 写接口统一守卫：返回 Response 表示拒绝，返回 null 表示放行。 */
export const requireAdmin = (request: Request): Response | null =>
  isAdmin(request) ? null : json({ error: '需要站务令牌' }, 401);
